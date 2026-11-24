import os,subprocess,re,json
F=os.path.join(os.path.dirname(os.path.abspath(__file__)),'../../../docs/curriculum/00-Pre-primary')+'/Curriculum and Syllabus for Pre-primary Education 2023 (English).pdf'
txt=subprocess.run(['pdftotext','-layout','-f','27','-l','40',F,'-'],capture_output=True,text=True).stdout
B=None; rows=[]
for line in txt.split('\n'):
    if 'Learning Activities' in line and 'Specific' in line:
        B=[line.index(w)-6 for w in ['Specific','Learning','Assessment','Suggested','Number']]; continue
    if not B or not line.strip() or re.fullmatch(r'\s*\d+\s*',line): continue
    if ('Competences' in line and 'Criteria' in line) or ('Periods' in line and 'resources' in line): continue
    cells=['']*6
    for mt in re.finditer(r'\S+(?: \S+)*',line):
        col=sum(1 for b in B if mt.start()>=b)
        cells[col]=(cells[col]+' '+mt.group()).strip()
    rows.append(cells)
items=[];curm='';MAINS={}
for m,s,a,_,_,p in rows:
    sp=re.search(r'\s(\d+\.[1-9]\d*)\s',' '+m+' ')
    if sp and not m.startswith(sp.group(1)): k=m.index(sp.group(1)); s=(m[k:]+' '+s).strip(); m=m[:k].strip()
    if re.match(r'\d+\.0\b',m): curm=m; MAINS[m.split()[0][0]]=m
    elif m and curm:
        mm=re.match(r'(\d+\.[1-9]\S*)\s*(.*)',m)
        if mm: s=(m+' '+s).strip()
        else: curm+=' '+m; MAINS[curm.split()[0][0]]=curm
    if re.match(r'\d+\.[1-9]\d*\b',s): items.append(dict(main=curm,spec=s,acts=[],per=None))
    elif s and items: items[-1]['spec']+=' '+s
    if items: items[-1]['main']=curm
    if p and re.fullmatch(r'\d{1,3}',p) and items and items[-1]['per'] is None: items[-1]['per']=int(p)
    if a and items:
        if re.match(r'\([a-z]\)',a): items[-1]['acts'].append(a)
        elif items[-1]['acts']: items[-1]['acts'][-1]+=' '+a
for it in items: it['main']=MAINS.get(it['spec'][0],it['main'])
# Cells that ran into the next column in the PDF, fixed by hand from the printed page (2026-11-23).
FIX_SPEC={'4.3':'4.3 Demonstrate mastery of the skills of self-reliance','2.4':'2.4 Kuonesha matendo ya kiimani kulingana na imani yake'}
FIX_ACT={'(c) Create sports materials Various sports':'(c) Create sports materials',
 '(a) Use early reading skills Early reading skills Alphabet cards, Alphabet':'(a) Use early reading skills',
 '(c) Pronounce first sounds First sounds of of names of pictures/ words/objects':'(c) Pronounce first sounds of names of pictures, words and objects',
 '(d) Identify works done by Works done by family members and family members and other people other people have been identified':'(d) Identify works done by family members and other people',
 '(b) Explain how to control Methods of feelings controlling feelings have been explained':'(b) Explain how to control feelings',
 '(a) Identify different types Different types of Pictures of different types of food':'(a) Identify different types of food',
 '(a) Mention objects found Objects found in the Models of different things, in the environment environment have been mentioned':'(a) Mention objects found in the environment',
 '(d) Identify safety signs in Safety signs in one’s one’s environment':'(d) Identify safety signs in one’s environment',
 '(b) Protect oneself against He/she has diseases':'(b) Protect oneself against diseases',
 '(d) Use various ICT tools Bibliography':'(d) Use various ICT tools',
 '(a) Do cleanliness in his/ her environment':'(a) Do cleanliness in his/her environment'}
for it in items:
    no=it['spec'].split()[0]
    if no in FIX_SPEC: it['spec']=FIX_SPEC[no]
    if no=='4.3' and not any(a.startswith('(a)') for a in it['acts']): it['acts'].insert(0,'(a) Do acts of self-reliance')
    it['acts']=[FIX_ACT.get(a,a) for a in it['acts']]
json.dump(items,open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'pre.json'),'w'),indent=1,ensure_ascii=False)
for it in items: print(it['per'],'|',it['main'][:45],'|',it['spec'][:45],'|',len(it['acts']),it['acts'][:2])
print(sum(i['per'] or 0 for i in items))
