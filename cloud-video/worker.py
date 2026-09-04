"""One-shot codec worker. Credentials/key enter via stdin, never command arguments."""
import base64
import json
import math
import os
import subprocess
import sys
import threading
from pathlib import Path
import codec
import fullframe
import stream_read


output_lock=threading.Lock()
def emit(event):
    with output_lock:
        print(json.dumps(event,ensure_ascii=False),flush=True)


def main():
    request=json.loads(sys.stdin.buffer.read(12*1024*1024))
    key=bytes.fromhex(request['key'])
    if request['operation']=='encode':
        out=Path(request['folder']);out.mkdir(parents=True,exist_ok=False)
        payload,meta=codec.seal(request['library'],key,request.get('parents',[]),request['device'])
        codec.atomic(out/'snapshot.bin',payload)
        packets=codec.packetize(payload,fullframe.BLOCK,fullframe.PROFILE)
        codec.require(len(packets)/2<=900,'snapshot exceeds 15 minute video limit')
        (out/'frames').mkdir()
        for index,packet in enumerate(packets):
            fullframe.render(packet).save(out/f'frames/{index:05d}.png')
            if index%8==0 or index==len(packets)-1:emit(dict(type='encode',frames=index+1,total=len(packets)))
        subprocess.run([os.environ.get('BIU_FFMPEG','ffmpeg'),'-v','error','-framerate','2','-i',str(out/'frames/%05d.png'),
            '-vf','fps=30,format=yuv420p','-c:v','libx264','-preset','fast','-crf','18','-movflags','+faststart',str(out/'video.mp4')],check=True,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        # Generated frame files are temporary; retain encrypted payload/video only.
        import shutil
        shutil.rmtree(out/'frames')
        emit(dict(type='result',snapshotId=codec.sha(payload)[:32],librarySha256=meta['librarySha256'],symbols=len(packets),duration=len(packets)/2))
    elif request['operation']=='decode':
        proof=stream_read.restore(request['url'],key,request['output'],request['snapshotId'],on_event=emit)
        emit(dict(type='result',**proof))
    else:raise ValueError('unsupported operation')

if __name__=='__main__':
    try:main()
    except Exception as error:
        # Avoid URLs, keys and snapshot bodies in the UI's diagnostic stream.
        known={'snapshot size outside supported range':'音乐库压缩后超过 512 KB，暂不支持本次同步',
               'snapshot exceeds 15 minute video limit':'音乐库超过单次视频容量限制'}
        emit(dict(type='error',message=known.get(str(error),'视频编码或认证解码失败'),kind=type(error).__name__))
        sys.exit(1)
