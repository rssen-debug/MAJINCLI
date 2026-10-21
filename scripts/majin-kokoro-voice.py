#!/usr/bin/env python3
"""Local-only opt-in Kokoro ONNX narrator voice for MAJIN.
Install dependencies and model separately. The server never uploads speech.
It accepts only JSON /speak calls from loopback app origins and returns WAV.
"""
import argparse
import io
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

MAX_TEXT_BYTES = 4096
PORT = 18765

def valid_origin(origin):
    if not origin:
        return True   # local curl/test clients; loopback binding still required
    try:
        p = urlparse(origin)
        return p.scheme in ("http", "https") and p.hostname in ("localhost", "127.0.0.1", "::1")
    except ValueError:
        return False

def serve(args):
    # Lazy imports: --help and tests work without large inference packages.
    from kokoro_onnx import Kokoro
    import soundfile as sf
    model = Kokoro(str(args.model.resolve()), str(args.voices.resolve()))
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def send(self, code, body, mime="application/json"):
            self.send_response(code)
            self.send_header("Content-Type", mime)
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin", "null") if valid_origin(self.headers.get("Origin")) else "null")
            self.send_header("Vary", "Origin")
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):
            if not valid_origin(self.headers.get("Origin")):
                return self.send(403, b'{"error":"origin_not_allowed"}')
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin", "null"))
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "content-type")
            self.send_header("Access-Control-Max-Age", "120")
            self.end_headers()

        def do_GET(self):
            if self.path != "/health":
                return self.send(404, b'{"error":"not_found"}')
            return self.send(200, json.dumps({"ok": True, "engine": "kokoro-onnx", "voice": args.voice, "local": True}).encode())

        def do_POST(self):
            if self.path != "/speak":
                return self.send(404, b'{"error":"not_found"}')
            if not valid_origin(self.headers.get("Origin")):
                return self.send(403, b'{"error":"origin_not_allowed"}')
            if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
                return self.send(415, b'{"error":"json_required"}')
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 1 <= length <= MAX_TEXT_BYTES:
                    return self.send(413, b'{"error":"request_too_large"}')
                payload = json.loads(self.rfile.read(length))
                phrase = payload.get("text", "")
                if not isinstance(phrase, str) or not phrase.strip() or len(phrase) > 700:
                    return self.send(400, b'{"error":"invalid_text"}')
                with lock:
                    samples, rate = model.create(phrase, voice=args.voice, speed=args.speed, lang="en-us")
                wav = io.BytesIO()
                sf.write(wav, samples, rate, format="WAV", subtype="PCM_16")
                return self.send(200, wav.getvalue(), "audio/wav")
            except Exception as e:
                self.log_error("TTS generation failed: %s", type(e).__name__)
                return self.send(500, b'{"error":"synthesis_failed"}')

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"MAJIN_KOKORO_READY http://127.0.0.1:{args.port} voice={args.voice}", flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()
        try:
            model.voices.close()
        except Exception:
            pass

def parser():
    p = argparse.ArgumentParser(description="MAJIN local Kokoro narrator (not a SunnyV2 voice clone)")
    p.add_argument("--model", type=Path, default=Path(__file__).parent / "models" / "kokoro-v1.0.onnx")
    p.add_argument("--voices", type=Path, default=Path(__file__).parent / "models" / "voices-v1.0.bin")
    p.add_argument("--voice", default="am_adam")
    p.add_argument("--speed", type=float, default=1.03)
    p.add_argument("--port", type=int, default=PORT)
    return p

if __name__ == "__main__":
    args = parser().parse_args()
    if not args.model.is_file() or not args.voices.is_file():
        parser().error("Kokoro model and voices data missing. Run scripts/install-kokoro-voice.ps1 first.")
    if not 0.75 <= args.speed <= 1.4 or not 1024 <= args.port <= 65535:
        parser().error("Invalid speed or port")
    serve(args)
