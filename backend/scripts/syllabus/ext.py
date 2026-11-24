import pdfplumber, re, json, sys, io
from pypdf import PdfReader, PdfWriter
import os; U=os.path.join(os.path.dirname(os.path.abspath(__file__)),'../../../docs/curriculum/')
ROM={'I':1,'II':2,'III':3,'IV':4,'V':5,'VI':6}
def cl(s): return re.sub(r'\s+',' ',(s or '').replace('\n',' ')).strip()
KEYS={'main':['main comp','umahiri mkuu','compétences principales','主要能力','تاراهملا ةماعلا','تايافكلا ةماعلا','ةماعلا'],
      'spec':['specific comp','umahiri mahususi','compétences spécifiques','具体能力','ةصاخلا'],
      'act':['learning activ','shughuli','activités','学习活动','ةطشنأ'],
      'per':['number of period','idadi ya vipindi','nombre des','课时','صصحلا']}
def colmap(head):
    m={}
    for i,h in enumerate(head):
        h=cl(h).lower()
        for k,ws in KEYS.items():
            if k not in m and any(w.lower() in h for w in ws): m[k]=i
    return m
LV=re.compile(r'(?:Contents? for Standard|Maudhui (?:ya|kwa) Darasa(?: la)?|classe|Standard)\s+(III|IV|VI|V|II|I)\b')
LAST=[None]; FALLBACK=[]
def extract(path, levelhint=None, pages=None):
    LAST[0]=None; FALLBACK.clear()
    for pg in pdfplumber.open(path).pages:
        for ft in pg.find_tables():
            t=ft.extract()
            if t and 'act' in colmap(t[0]) and 'spec' in colmap(t[0]):
                LAST[0]=sorted(set([round(c[0]) for c in ft.cells if c]+[round(c[2]) for c in ft.cells if c])); break
        if LAST[0]: break
    pdf=pdfplumber.open(path); out=[]; level=levelhint; m=None; main=spec=None
    for i,pg in enumerate(pdf.pages):
        if pages and i not in pages: continue
        txt=pg.extract_text() or ''
        for line in txt.split('\n'):
            if '....' in line: continue
            mm=re.search(r'(?i)(?:Contents? for Standard|Maudhui (?:ya|kwa) Darasa(?: la)?|Darasa la|pour la)\s+(III|IV|VI|V|II|I)(?:e\b|\b)',line)
            if mm and re.search(r'(?i)content|maudhui|contenu',line): level='P%d'%ROM[mm.group(1).upper()]
        found=pg.find_tables(); tabs=[]; ok=False
        for ft in found:
            t=ft.extract()
            if t and 'act' in colmap(t[0]):
                ok=True; xs=sorted(set([round(c[0]) for c in ft.cells if c]+[round(c[2]) for c in ft.cells if c])); LAST[0]=xs
            tabs.append(t)
        if not ok and LAST[0] and re.search(r'(?i)learning activ|shughuli za|activités d',txt):
            def dd(v):
                o=[]
                for x in sorted(v):
                    if not o or x-o[-1]>3: o.append(x)
                return o
            vx=dd(set(round(l['x0']) for l in pg.lines+pg.rects if abs(l['x0']-l['x1'])<1.5))
            hy=dd(set(round(l['top']) for l in pg.lines+pg.rects if abs(l['top']-l['bottom'])<1.5))
            try:
                tabs=pg.extract_tables(dict(vertical_strategy='explicit',explicit_vertical_lines=vx,horizontal_strategy='explicit',explicit_horizontal_lines=hy)) if len(vx)>=5 and len(hy)>=3 else []
                tabs=[tt[[k for k,rr in enumerate(tt) if 'act' in colmap(rr)][0]:] if any('act' in colmap(rr) for rr in tt[:4]) else tt for tt in tabs]
            except Exception as e: tabs=[]
            FALLBACK.append(i+1)
        for t in tabs:
            if not t: continue
            cm=colmap(t[0]); rows=t[1:]
            if 'act' in cm and 'spec' in cm: m=cm
            elif m and len(t[0])==len(m and t[0]) and not cm: rows=t
            else:
                if not ('act' in cm): continue
            if not m: continue
            for r in rows:
                if len(r)<=max(m.values()): continue
                g=lambda k: cl(r[m[k]]) if k in m and r[m[k]] else ''
                if g('main') and not g('main').lower().startswith('main'): main=g('main')
                if g('spec'): spec=g('spec')
                a=g('act'); per=re.sub(r'[^0-9]','',g('per'))
                if not (a or per): continue
                out.append(dict(level=level,main=main,spec=spec,act=a,per=int(per) if per else None,page=i+1))
    return out
if __name__=='__main__':
    f=sys.argv[1]; r=extract(U+f)
    print(len(r)); 
    for x in r[:int(sys.argv[2]) if len(sys.argv)>2 else 8]: print(x)
    from collections import Counter; print(Counter(x['level'] for x in r)); print('periods by level',{l:sum(x['per'] or 0 for x in r if x['level']==l) for l in set(x['level'] for x in r)})
