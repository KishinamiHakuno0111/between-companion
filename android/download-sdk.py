import hashlib, urllib.request, zipfile
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

root=Path(__file__).resolve().parent/'tools'
root.mkdir(exist_ok=True)
packages=[
 ('platform-36_r02.zip','2c1a80dd4d9f7d0e6dd336ec603d9b5c55a6f576'),
 ('build-tools_r36_windows.zip','f16ccffd34de8790dede813a6c7d8e2c11a27b50'),
 ('platform-tools_r37.0.3-win.zip','b3fde5239ad89229d5a9178375b81c9887a24172'),
]
def get(item):
    filename,expected=item;target=root/filename
    if not target.exists():
        with urllib.request.urlopen('https://dl.google.com/android/repository/'+filename,timeout=90) as response, target.open('wb') as out:
            while chunk:=response.read(1024*1024):out.write(chunk)
    if hashlib.sha1(target.read_bytes()).hexdigest()!=expected:raise RuntimeError('Checksum failed: '+filename)
    with zipfile.ZipFile(target) as z:
        for entry in z.infolist():
            dest=(root/entry.filename).resolve()
            if not dest.is_relative_to(root):raise RuntimeError('Unsafe archive path')
        z.extractall(root)
    print('Ready: '+filename,flush=True)
with ThreadPoolExecutor(max_workers=3) as pool:list(pool.map(get,packages))
