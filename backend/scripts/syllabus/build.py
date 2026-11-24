import os,sys,re,json; sys.path.insert(0,os.path.dirname(os.path.abspath(__file__))); import ext
P='01-Primary/'
SRC=[('PRE','Pre-primary Education Syllabus (2023)','00-Pre-primary/Curriculum and Syllabus for Pre-primary Education 2023 (English).pdf','en'),
 ('STD12','Primary Education Syllabus Standard I-II (2023)',P+'Std I-II - Primary Education Syllabus (English).pdf','en'),
 ('MATH','Mathematics Standard III-VI (2023)',P+'Std III-VI - Mathematics (English).pdf','en'),
 ('SCI','Science Standard III-VI (2023)',P+'Std III-VI - Science (English).pdf','en'),
 ('ENG','English Standard III-VI (2023)',P+'Std III-VI - English.pdf','en'),
 ('KIS','Kiswahili Darasa la III-VI (2023)',P+'Std III-VI - Kiswahili.pdf','sw'),
 ('GEO','Geography and Environment Standard III-VI (2023)',P+'Std III-VI - Geography and Environment (English).pdf','en'),
 ('HIST','Historia ya Tanzania na Maadili Darasa la III-VI (2023)',P+'Std III-VI - Historia ya Tanzania na Maadili.pdf','sw'),
 ('CAS','Arts and Sports Standard III-VI (2023)',P+'Std III-VI - Arts and Sports (English).pdf','en'),
 ('FRE','French Standard III-VI (2023)',P+'Std III-VI - French.pdf','fr'),
 ('CHI','Chinese (Kichina) Darasa la III-VI (2023)',P+'Std III-VI - Chinese (Kichina).pdf','sw'),
 ('ARA','Arabic (Kiarabu) Darasa la III-VI (2023)',P+'Std III-VI - Arabic (Kiarabu).pdf','sw')]
def c(s):
    s=s or ''
    s=re.sub(r'[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿一-鿿　-〿＀-￯]+',' ',s)
    s=re.sub(r'\)\s*([a-z])\s*\(',r'(\1)',s)
    s=re.sub(r'\(\s*\)|\)\s*\(',' ',s)
    s=re.sub(r'\s?\d?\s?\*{2,}\s?',' ',s)
    s=re.sub(r'\s+',' ',s).strip(' ،.؛')
    s=re.sub(r'^(\d+\.\d+)\s+\1\b',r'\1',s)
    s=re.sub(r'^(\([a-z]\))\s+(\([a-z]\))',r'\2',s)
    # Letters cut off by the PDF: "D evelop" -> "Develop", "(b) J oin" -> "(b) Join" (not the words "A" and "I").
    s=re.sub(r'(^|\([a-z]\) |\d+\.\d+ )([B-HJ-Z]) ([a-z]{2,})',r'\1\2\3',s)
    # A word split at the end of a line: "pre- writing" -> "pre-writing".
    s=re.sub(r'(\w)- (\w)',r'\1-\2',s)
    return s.strip()
out=[]
for ref,title,f,lang in SRC:
    if ref=='PRE':
        raw=json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'pre.json'))); rows=[]
        for it in raw:
            for a in it['acts'] or ['']: rows.append(dict(level='PP',main=it['main'],spec=it['spec'],act=a,per=it['per'] if a==(it['acts'] or [''])[0] else None))
    else:
        rows=[x for x in ext.extract(ext.U+f) if x['level']]
    topics=[]; idx={}
    for x in rows:
        main=c(x['main']); spec=c(x['spec']); act=c(x['act'])
        mm=re.match(r'(\d+\.0)\s*(.*)',main) or re.match(r'()(.*)',main)
        sm=re.match(r'(\d+\.\d+)\s*(.*)',spec)
        mno=mm.group(1) or ''; mtx=mm.group(2)
        if sm: sno,stx=sm.group(1),sm.group(2)
        else: sno,stx=(mno[:-1]+'1' if mno else ''),spec
        if not mno and sno: mno=sno.split('.')[0]+'.0'
        k=(x['level'],sno)
        if k not in idx:
            idx[k]=dict(level=x['level'],mainNo=mno,main=mtx,no=sno,text=stx,periods=None,items=[]); topics.append(idx[k])
        t=idx[k]
        if x['per']: t['periods']=(t['periods'] or 0)+x['per']
        if act and not re.fullmatch(r'[\d\s]+',act):
            act=re.sub(r'^\(([a-z])\)\s*',r'(\1) ',act)
            if t['items'] and not re.match(r'\([a-z]\)',act) and re.match(r'\([a-z]\)',t['items'][-1]['text']): t['items'][-1]['text']+=' '+act; t['items'][-1]['periods']=(t['items'][-1]['periods'] or 0)+(x['per'] or 0) or None
            elif act not in [i['text'] for i in t['items']]: t['items'].append(dict(text=act,periods=x['per']))
    out.append(dict(ref=ref,title=title,source=f.split('/')[-1],language=lang,topics=topics))
    from collections import Counter
    print(ref,len(topics),sum(len(t['items']) for t in topics),dict(Counter(t['level'] for t in topics)),{l:sum(t['periods'] or 0 for t in topics if t['level']==l) for l in sorted(set(t['level'] for t in topics))})
json.dump(out,open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'../../src/data/syllabus-2027-primary.json'),'w'),ensure_ascii=False,indent=0)
