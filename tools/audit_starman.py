"""Inspect current primary HF tables and one schema per superseded table.

Download the dataset info with `hf datasets info REPO --format json > info.json`
and pinned manifests first. Existing manifest-listed Parquets are reused only when
their SHA-256 matches. Published archives/QA are inventoried separately.
"""
import argparse
import json,re,hashlib
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from huggingface_hub import hf_hub_download
import pyarrow.parquet as pq
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('info',type=Path)
parser.add_argument('output',type=Path)
args=parser.parse_args()
ROOT=args.output
ROOT.mkdir(parents=True,exist_ok=True)
info=json.loads(args.info.read_text())
paths=[x['rfilename'] for x in info['siblings'] if x['rfilename'].endswith('.parquet') and x['rfilename'].startswith(('layers/','terrain/','context/','regional/','sites/','windows/'))]
groups={}
for p in paths:groups.setdefault(str(Path(p).parent),[]).append(p)
def version(p):
 m=re.search(r'(?:feature_)?version=[^/]*-v([\d.]+)',p)
 return tuple(map(int,m[1].split('.'))) if m else ()
def logical(p):return re.sub(r'(?:feature_)?version=[^/]+','version=*',p)
latest={}
for p in groups:
 key=logical(p)
 if key not in latest or version(p)>version(latest[key]):latest[key]=p
active={p for g in latest.values() for p in groups[g]}
local={}
def walk(x):
 if isinstance(x,dict):
  dest=x.get('destination') or x.get('path'); src=x.get('local_path'); sha=x.get('sha256')
  if dest and src and sha and src.endswith('.parquet') and Path(src).is_file():local[dest]=(src,sha)
  for v in x.values():walk(v)
 elif isinstance(x,list):
  for v in x:walk(v)
for p in (ROOT/'manifests').glob('*.json'):walk(json.loads(p.read_text()))
def fetch(p):
 if p in local:
  src,expected=local[p]; digest=hashlib.sha256(Path(src).read_bytes()).hexdigest()
  if digest==expected:return p,src,digest
 src=hf_hub_download(info['id'],p,repo_type='dataset',revision=info['sha'],local_dir=ROOT)
 return p,src,hashlib.sha256(Path(src).read_bytes()).hexdigest()
# Every historical table is represented in the audit; all current shards are inspected.
wanted=sorted(active|{v[0] for k,v in groups.items() if k not in latest.values()})
receipt={'repo':info['id'],'revision':info['sha'],'tables':{},'files':{},
         'other_files':[x['rfilename'] for x in info['siblings'] if x['rfilename'] not in paths],
         'schema_policy':'All current primary shards; one representative schema per superseded table; archives and provenance are file-inventoried only'}
with ThreadPoolExecutor(max_workers=6) as ex:
 for i,(p,src,sha) in enumerate(ex.map(fetch,wanted)):
  file=pq.ParquetFile(src); table=str(Path(p).parent)
  schemas=[{'name':f.name,'type':str(f.type)} for f in file.schema_arrow]
  entry=receipt['tables'].setdefault(table,{'current':table in latest.values(),'files':groups[table],'schemas':[]})
  if schemas not in entry['schemas']:entry['schemas'].append(schemas)
  receipt['files'][p]={'local':src,'sha256':sha,'rows':file.metadata.num_rows}
  if i%50==0:print(i,len(wanted),p,flush=True)
  (ROOT/'source-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
print('DONE',len(receipt['files']),len(receipt['tables']),flush=True)
