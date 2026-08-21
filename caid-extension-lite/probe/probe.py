#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CAID Server Probe — 零依赖单文件探针
=====================================
为 CAID 工作台 newtab「服务器监控」功能提供指标接口。

用法:
    python3 probe.py                                    # 默认 0.0.0.0:8601，无鉴权（仅建议内网）
    python3 probe.py --port 8601 --token sk-xxx         # Bearer Token 鉴权
    python3 probe.py --port 8601 --user admin --password p  # Basic 鉴权
    python3 probe.py --bind 127.0.0.1                   # 只监听本机（配合反代）

接口:
    GET /probe    -> JSON 指标（未授权返回 401）
    GET /health   -> {"ok": true}（免鉴权，供在线探测）

系统支持: Linux 完整（读 /proc，零第三方依赖）；macOS 部分；Windows 建议 Docker。
"""
import argparse
import base64
import json
import os
import platform
import shutil
import socket
import subprocess
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VERSION = "1.0.0"
AUTH = {"mode": "none", "token": "", "user": "", "pass": ""}


def _read_proc(path):
    try:
        with open(path, "r") as f:
            return f.read()
    except Exception:
        return None


def cpu_percent():
    """Linux: /proc/stat 两次采样差值；其他平台返回 None。"""
    if not os.path.exists("/proc/stat"):
        return None
    def sample():
        data = _read_proc("/proc/stat")
        if not data:
            return None
        parts = data.split("\n")[0].split()
        vals = [int(x) for x in parts[1:8]]
        idle = vals[3] + (vals[4] if len(vals) > 4 else 0)
        return sum(vals), idle
    try:
        s1 = sample()
        time.sleep(0.2)
        s2 = sample()
        if not s1 or not s2:
            return None
        total = s2[0] - s1[0]
        idle = s2[1] - s1[1]
        if total <= 0:
            return None
        return round((total - idle) * 100.0 / total, 1)
    except Exception:
        return None


def mem_info():
    if os.path.exists("/proc/meminfo"):
        try:
            kv = {}
            for line in _read_proc("/proc/meminfo").splitlines():
                k, _, v = line.partition(":")
                kv[k.strip()] = int(v.strip().split()[0]) * 1024
            total = kv.get("MemTotal", 0)
            avail = kv.get("MemAvailable", kv.get("MemFree", 0))
            used = max(total - avail, 0)
            return {"total": total, "used": used, "free": avail,
                    "percent": round(used * 100.0 / total, 1) if total else None}
        except Exception:
            return None
    return None


def disk_info(path="/"):
    try:
        d = shutil.disk_usage(path)
        return {"total": d.total, "used": d.used, "free": d.free,
                "percent": round(d.used * 100.0 / d.total, 1)}
    except Exception:
        return None


def net_info():
    if not os.path.exists("/proc/net/dev"):
        return None
    try:
        out = []
        for line in _read_proc("/proc/net/dev").splitlines()[2:]:
            iface, _, rest = line.partition(":")
            iface = iface.strip()
            if iface == "lo":
                continue
            parts = rest.split()
            if len(parts) >= 9:
                out.append({"iface": iface, "rx_bytes": int(parts[0]),
                            "tx_bytes": int(parts[8])})
        return out
    except Exception:
        return None


def uptime_sec():
    data = _read_proc("/proc/uptime")
    if data:
        try:
            return float(data.split()[0])
        except Exception:
            return None
    return None


def load_avg():
    fn = getattr(os, "getloadavg", None)
    if fn is None:
        return None
    try:
        return [round(x, 2) for x in fn()]
    except Exception:
        return None


def ips():
    result = []
    try:
        result = list(socket.gethostbyname_ex(socket.gethostname())[2])
    except Exception:
        pass
    if os.name == "posix":
        try:
            raw = subprocess.check_output(["hostname", "-I"], timeout=3,
                                          stderr=subprocess.DEVNULL).decode()
            for ip in raw.split():
                ip = ip.strip()
                if ip and ip not in result:
                    result.append(ip)
        except Exception:
            pass
    return result


def collect():
    return {
        "ok": True,
        "ts": time.time(),
        "agent": "caid-probe/" + VERSION,
        "hostname": socket.gethostname(),
        "platform": platform.platform(),
        "python": platform.python_version(),
        "uptime": uptime_sec(),
        "loadavg": load_avg(),
        "cpu_percent": cpu_percent(),
        "mem": mem_info(),
        "disk": disk_info("/"),
        "net": net_info(),
        "ips": ips(),
    }


def authorized(handler):
    if AUTH["mode"] == "none":
        return True
    h = handler.headers
    if AUTH["mode"] == "token":
        got = h.get("Authorization", "")
        return got == "Bearer " + AUTH["token"] or got == AUTH["token"]
    if AUTH["mode"] == "basic":
        expect = base64.b64encode(("%s:%s" % (AUTH["user"], AUTH["pass"])).encode()).decode()
        return h.get("Authorization", "") == "Basic " + expect
    return False


class Handler(BaseHTTPRequestHandler):
    server_version = "CAIDProbe/" + VERSION

    def _send(self, code, payload, ctype="application/json; charset=utf-8"):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/health":
            return self._send(200, {"ok": True})
        if path == "/probe":
            if not authorized(self):
                self.send_response(401)
                self.send_header("WWW-Authenticate", 'Bearer realm="caid-probe"')
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            return self._send(200, collect())
        self._send(404, {"ok": False, "error": "not found"})

    def log_message(self, fmt, *args):
        print("[probe] %s - %s" % (self.address_string(), fmt % args))


def main():
    ap = argparse.ArgumentParser(description="CAID Server Probe")
    ap.add_argument("--port", type=int, default=8601)
    ap.add_argument("--bind", default="0.0.0.0")
    ap.add_argument("--token", default="")
    ap.add_argument("--user", default="")
    ap.add_argument("--password", default="")
    args = ap.parse_args()

    if args.token:
        AUTH["mode"], AUTH["token"] = "token", args.token
    elif args.user and args.password:
        AUTH["mode"], AUTH["user"], AUTH["pass"] = "basic", args.user, args.password

    srv = ThreadingHTTPServer((args.bind, args.port), Handler)
    print("[probe] CAID Server Probe %s  listening on %s:%d  auth=%s"
          % (VERSION, args.bind, args.port, AUTH["mode"]))
    if AUTH["mode"] == "none":
        print("[probe] WARNING: 未设置鉴权！请勿直接暴露到公网，建议加 --token 或反代 + 防火墙。")
    print("[probe] probe:   curl http://localhost:%d/probe" % args.port)
    print("[probe] health:  curl http://localhost:%d/health" % args.port)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n[probe] bye")


if __name__ == "__main__":
    main()
