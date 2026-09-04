"""Bounded streaming restore benchmark; requires an expected snapshot ID.

Only the authenticated requested snapshot is returned. Unread trailing frames
are deliberately not checked; this is a snapshot reader, not a whole-video audit.
"""
import argparse
import json
import queue
import subprocess
import tempfile
import threading
import time
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

import numpy as np
import codec
import fullframe as ff

CHUNK=16384
CAP=512*1024*1024
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'


def restore(source,key,output,expected,mode='stream',rate=0,timeout=120,on_event=lambda event: None):
    codec.require(mode in ('stream','whole'), 'invalid mode')
    codec.require(rate>=0 and timeout>0, 'invalid rate or timeout')
    codec.require(len(expected)==32 and all(c in '0123456789abcdef' for c in expected), 'expected snapshot ID required')
    started=time.monotonic()
    stats=dict(mode=mode,rateBytesPerSecond=rate,receivedBytes=0,totalBytes=None)
    stop=threading.Event()
    errors=[]
    worker=None
    reader=None
    process=None
    watchdog=threading.Timer(timeout,stop.set)
    watchdog.daemon=True
    watchdog.start()

    def chunks():
        if str(source).startswith('https://'):
            parsed=urlparse(source)
            allowed=lambda host:any(host==h or host.endswith('.'+h) for h in ('bilivideo.com','bilivideo.cn'))
            codec.require(allowed(parsed.hostname or ''), 'expected Bilibili CDN URL')
            request=urllib.request.Request(source,headers={'Referer':'https://www.bilibili.com/','User-Agent':UA})
            response=urllib.request.urlopen(request,timeout=min(timeout,5))
            codec.require(allowed(urlparse(response.url).hostname or ''), 'unexpected redirect')
            total=response.headers.get('Content-Length')
            stats['totalBytes']=int(total) if total else None
        else:
            response=open(source,'rb')
            stats['totalBytes']=Path(source).stat().st_size
        with response:
            codec.require(stats['totalBytes'] is None or stats['totalBytes']<=CAP,'video too large')
            body_start=time.monotonic()
            while not stop.is_set():
                data=response.read(CHUNK)
                if not data:break
                stats.setdefault('firstByteSeconds',round(time.monotonic()-started,4))
                stats['receivedBytes']+=len(data)
                on_event(dict(type='download', bytes=stats['receivedBytes'], total=stats['totalBytes']))
                codec.require(stats['receivedBytes']<=CAP,'video too large')
                if rate:
                    delay=stats['receivedBytes']/rate-(time.monotonic()-body_start)
                    if delay>0 and stop.wait(delay):break
                yield data

    try:
        # Small probe and one decode thread avoid buffering seconds of video.
        command=['ffmpeg','-v','error','-probesize','32768','-analyzeduration','0',
            '-threads','1','-i','pipe:0','-an','-vf','fps=4,scale=640:360',
            '-threads','1','-f','rawvideo','-pix_fmt','gray','pipe:1']
        with tempfile.TemporaryFile() as err:
            process=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=err,bufsize=0,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            def feed():
                try:
                    for data in chunks():
                        view=memoryview(data)
                        while view and not stop.is_set():
                            n=process.stdin.write(view)
                            if not n:raise BrokenPipeError()
                            view=view[n:]
                except Exception as e:
                    if not stop.is_set():errors.append(e)
                finally:
                    process.stdin.close()
            worker=threading.Thread(target=feed,daemon=True)
            worker.start()
            # Windows select() cannot monitor subprocess pipes. A bounded reader
            # thread also lets the main loop honor the deadline while FFmpeg stalls.
            decoded=queue.Queue(maxsize=2)
            def deliver(frame):
                while not stop.is_set():
                    try:decoded.put(frame,timeout=.1);return
                    except queue.Full:pass
            def read_frames():
                try:
                    buffer=bytearray()
                    while not stop.is_set():
                        data=process.stdout.read(640*360-len(buffer))
                        if not data:break
                        buffer.extend(data)
                        if len(buffer)==640*360:
                            deliver(bytes(buffer))
                            buffer.clear()
                except Exception as e:
                    if not stop.is_set():errors.append(e)
                finally:deliver(b'')
            reader=threading.Thread(target=read_frames,daemon=True)
            reader.start()
            packets={}
            frames=0
            verified=False
            while not stop.is_set():
                try:data=decoded.get(timeout=.1)
                except queue.Empty:continue
                if not data:break
                frames+=1
                on_event(dict(type='frame', frame=frames, mediaSeconds=frames/4))
                stats.setdefault('firstFrameSeconds',round(time.monotonic()-started,4))
                pixels=np.frombuffer(data,dtype=np.uint8).reshape(360,640)
                for packet in ff.read(pixels):
                    parsed=codec.parse(packet,ff.BLOCK,ff.PROFILE)
                    if not parsed:continue
                    group,index,_=parsed
                    codec.require(group[0].hex()==expected,'unexpected snapshot')
                    codec.require(index not in packets or packets[index]==packet,'conflicting duplicate')
                    packets[index]=packet
                    on_event(dict(type='symbol', symbols=len(packets), needed=group[1]))
                    if len(packets)<group[1]:continue
                    try:payload,_=codec.recover(packets.values(),expected,ff.BLOCK,ff.PROFILE)
                    except ValueError as e:
                        if 'not enough independent symbols' in str(e):continue
                        raise
                    raw,meta=codec.unseal(payload,key)
                    codec.require(not stop.is_set(),'stream deadline exceeded')
                    codec.atomic(output,raw)
                    stats.update(symbols=len(packets),scannedFrames=frames,librarySha256=codec.sha(raw),libraryBytes=len(raw),verifiedSeconds=round(time.monotonic()-started,4),mediaSecondsScanned=frames/4)
                    verified=True
                    stop.set()
                    break
                del pixels
            if not verified:
                if errors:raise errors[0]
                raise ValueError('timeout or insufficient authenticated stream data')
    finally:
        stop.set()
        watchdog.cancel()
        if process:
            # This disposable decoder has no output to flush after authentication.
            # SIGTERM can block flushing its unread raw-frame pipe.
            if process.poll() is None:process.kill()
            process.wait()
            if reader:
                reader.join(timeout=2)
                codec.require(not reader.is_alive(),'decoder worker did not stop')
            process.stdout.close()
        if worker:
            worker.join(timeout=6)
            codec.require(not worker.is_alive(),'network worker did not stop')
    stats['closedSeconds']=round(time.monotonic()-started,4)
    stats['downloadFraction']=round(stats['receivedBytes']/stats['totalBytes'],4) if stats['totalBytes'] else None
    stats['snapshotId']=expected
    on_event(dict(type='verified', **stats))
    stats['passed']=True
    return stats
