"""Make the 10 test class lists (Baby, Middle, Nursery, P1 ... P7), 200 students each, 2000 in all.

Run:  python make_class_files.py      (needs: pip install openpyxl)

The data behaves like a real school:
- Families. Brothers and sisters share the father's surname and have the father's first name as middle name,
  and they are in DIFFERENT classes (twins sometimes in the same class). Most families have 1 child, some 2-4.
- Guardians are real people with full names (JOHN MATHIAS MREMA, GRACE TIBAIJUKA), never "Mr John" or "Mama Simon".
- One phone = one person. The same guardian has the same name and phone on each of their children.
- Most children have Father + Mother; some have the mother first, some a single parent with a grandmother,
  uncle or aunt; some orphans with an uncle and aunt; some have 4, 5 or 6 guardians.
- Boys get boys' names and girls get girls' names.
The columns are exactly the ones the system downloads and uploads (Guardian 1 Name, Guardian 1 Phone,
Guardian 1 Relationship, Guardian 2 ...), as many guardian groups as the class needs.
"""
import random
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment

random.seed(20261123)

CLASSES = [('Baby', '01'), ('Middle', '02'), ('Nursery', '03'), ('P1', '04'), ('P2', '05'), ('P3', '06'), ('P4', '07'), ('P5', '08'), ('P6', '09'), ('P7', '10')]
PER_CLASS = 200

MEN = """JOHN MATHIAS PETER JOSEPH DANIEL EMMANUEL GODFREY HASSAN ALLY JUMA BARAKA AMANI MUSA OMARI ABDALLAH SAIDI
FRANK GEORGE CHARLES RICHARD MICHAEL DAVID PAUL STEPHEN ANDREW SAMWEL ELIA YOHANA FESTO GERVAS DEUSDEDIT
PASCHAL ALOYCE LEONARD BONIFACE CLEMENT ERASTO HAMISI RASHIDI SHABANI SELEMANI MOHAMEDI ISSA YUSUFU ATHUMANI
REUBEN TITUS OSCAR KELVIN EDWIN BENARD JACKSON NELSON WILLIAM ROBERT DENIS COSMAS PROSPER ANSELM SILVESTER
FAUSTINE NICODEMUS ZAKARIA ELISHA JOEL ISAYA EZEKIEL AMOS LAZARO KASSIMU HUSSEIN SALUM MRISHO HEMEDI""".split()
WOMEN = """GRACE NEEMA ANNA MARY ESTHER REHEMA AMINA HALIMA ZAINABU MWANAIDI JOYCE AGNES CATHERINE ELIZABETH VERONICA
SCHOLASTICA JACKLINE IRENE MAGRETH DORCAS LYDIA SARAH RUTH FATUMA MARIAM ASHA SALMA ZUHURA HADIJA TATU
PENDO UPENDO ZAWADI TUMAINI FURAHA SHUKURU WINFRIDA EDINA LEOKADIA PRISCA ROSE JANETH GLORIA HAPPY
BEATRICE DEBORA EUNICE FLORA GETRUDA HELENA IMACULATA JOSEPHINE LUCY MAUA NASRA OLIVIA PASKALIA QUEEN
REGINA SIKUJUA TABITHA VAILETH WITNESS YUSTA ZAITUNI MWAJUMA MWANAHAWA SHANI SUBIRA""".split()
SURNAMES = """MREMA MASSAWE MUSHI KIMARO TEMBA SWAI MOSHI LYIMO TARIMO URIO SHIRIMA MINJA KWAYU
TIBAIJUKA RUGEMALIRA KAIJAGE MUTALEMWA BYABATO KAMUGISHA RWEYEMAMU BAMPORIKI
MASANJA MAGESA MAYALA KISENA NG'WANAKILALA SHIJA LUHENDE MABULA BULUGU
MWAKYUSA MWAKALINGA MWAMBENE MWASAKAFYUKA KAPINGA KOMBA NDUNGURU HAULE MBAWALA
CHACHA MWITA MARWA WAMBURA NYAMHANGA MAGIGE OMARI JUMA HASSANI MCHOMVU KITWANA
MAKAME MAKUNDI MBWAMBO MCHOME SANGA MLAY KESSY NJAU MOLLEL LAIZER LUKUMAY
NYERERE MAGUFULI KIKWETE MSUYA MUSABE DAMIAN MBEIKYA KIBONA MAHENGE NGOWI""".split()
# Avoid very famous surnames for invented people.
SURNAMES = [s for s in SURNAMES if s not in ('NYERERE', 'MAGUFULI', 'KIKWETE', 'MUSABE')]

PREFIXES = ['061', '062', '065', '067', '068', '069', '071', '073', '074', '075', '076', '077', '078']
used_phones, used_people = set(), set()


def phone():
    while True:
        p = random.choice(PREFIXES) + f'{random.randint(0, 9999999):07d}'
        if p not in used_phones:
            used_phones.add(p)
            return p


def person(first_pool, middle=None, last=None):
    """A new adult with a unique full name and phone."""
    while True:
        first = random.choice(first_pool)
        mid = middle or random.choice(MEN)
        sur = last or random.choice(SURNAMES)
        if first == mid:
            continue
        name = f'{first} {mid} {sur}'
        if name not in used_people:
            used_people.add(name)
            return {'name': name, 'phone': phone(), 'first': first, 'middle': mid, 'last': sur}


def family_guardians():
    """The adults of one family and the guardian list its children share."""
    father = person(MEN)
    mother = person(WOMEN)
    kind = random.random()
    G = lambda p, rel: (p['name'], p['phone'], rel)  # noqa: E731
    if kind < 0.66:
        return father, [G(father, 'Father'), G(mother, 'Mother')]
    if kind < 0.78:
        return father, [G(mother, 'Mother'), G(father, 'Father')]
    if kind < 0.84:  # single mother; grandmother helps
        gm = person(WOMEN, last=mother['last'])
        return father, [G(mother, 'Mother'), G(gm, 'Grandmother')]
    if kind < 0.88:  # single father; his sister helps
        aunt = person(WOMEN, middle=father['middle'], last=father['last'])
        return father, [G(father, 'Father'), G(aunt, 'Aunt')]
    if kind < 0.93:  # parents and an uncle
        uncle = person(MEN, middle=father['middle'], last=father['last'])
        return father, [G(father, 'Father'), G(mother, 'Mother'), G(uncle, 'Uncle')]
    if kind < 0.96:  # orphan: father's brother and sister
        uncle = person(MEN, middle=father['middle'], last=father['last'])
        aunt = person(WOMEN, middle=father['middle'], last=father['last'])
        return father, [G(uncle, 'Uncle'), G(aunt, 'Aunt'), G(person(MEN, middle=father['middle'], last=father['last']), 'Guardian')][:random.choice([2, 3])]
    if kind < 0.985:  # 4 guardians: parents, grown-up brother, grandmother
        bro = person(MEN, middle=father['first'], last=father['last'])
        gm = person(WOMEN)
        return father, [G(father, 'Father'), G(mother, 'Mother'), G(bro, 'Brother'), G(gm, 'Grandmother')]
    # 5 or 6 guardians
    gf = person(MEN, middle=random.choice(MEN), last=father['last'])
    gm = person(WOMEN)
    uncle = person(MEN, middle=father['middle'], last=father['last'])
    sis = person(WOMEN, middle=father['first'], last=father['last'])
    lst = [G(father, 'Father'), G(mother, 'Mother'), G(gf, 'Grandfather'), G(gm, 'Grandmother'), G(uncle, 'Uncle'), G(sis, 'Sister')]
    return father, lst[:random.choice([5, 6])]


# ---- Families and their children, spread over the classes ----
capacity = {c: PER_CLASS for c, _ in CLASSES}
order = [c for c, _ in CLASSES]
students = {c: [] for c in order}
used_children = set()
total = PER_CLASS * len(CLASSES)
made = 0
while made < total:
    size = random.choices([1, 2, 3, 4], weights=[55, 28, 13, 4])[0]
    size = min(size, total - made)
    free = [c for c in order if capacity[c] > 0]
    if not free:
        break
    twins = size >= 2 and random.random() < 0.05
    picks = random.sample(free, min(size - (1 if twins else 0), len(free)))
    if twins:
        picks.append(picks[0])
    picks = [c for c in picks if capacity[c] > 0]
    father, guardians = family_guardians()
    for c in picks:
        if capacity[c] <= 0:
            continue
        while True:
            sex = random.choice('MF')
            first = random.choice(MEN if sex == 'M' else WOMEN)
            full = f"{first} {father['first']} {father['last']}"
            if first != father['first'] and full not in used_children:
                break
        used_children.add(full)
        students[c].append({'first': first, 'middle': father['first'], 'last': father['last'], 'sex': sex, 'guardians': guardians})
        capacity[c] -= 1
        made += 1

HEAD_FILL = PatternFill('solid', fgColor='16794A')
HOW = [
    'One file for ONE class. On the Students page choose the class, then upload the file.',
    'Columns: Admission No., First name, Middle name, Last name, Sex, then the guardians.',
    'Guardians: Guardian 1 Name, Guardian 1 Phone, Guardian 1 Relationship, then Guardian 2 ..., Guardian 3 ... As many as needed: add Guardian 7, 8 ... the same way.',
    'Every student needs at least one guardian. Leave the extra guardian columns empty when a student has fewer.',
    'Guardian name: the real names, at least two, e.g. JOHN MATHIAS or GRACE TIBAIJUKA. Not "Mr John", "Mrs Grace" or "Mama Simon".',
    'Relationship: Father, Mother, Brother, Sister, Grandfather, Grandmother, Uncle, Aunt, Guardian, Other.',
    'Phone: 10 digits starting 06 or 07. The phone columns are Text so Excel keeps the 0.',
    'One phone is one person: a guardian with several children at school has the same name and phone on each child.',
    'Sex: M or F.',
]


def write_class(path, rows, extra_class=None):
    wb = Workbook()
    ws = wb.active
    ws.title = 'Class list'
    n = max(2, max(len(r['guardians']) for r in rows))
    head = ['S/N', 'Admission No.', 'First name', 'Middle name', 'Last name', 'Sex']
    for i in range(1, n + 1):
        head += [f'Guardian {i} Name', f'Guardian {i} Phone', f'Guardian {i} Relationship']
    if extra_class:
        head.append('Class')
    ws.append(head)
    for cell in ws[1]:
        cell.font = Font(bold=True, color='FFFFFF')
        cell.fill = HEAD_FILL
        cell.alignment = Alignment(vertical='center')
    for k, r in enumerate(rows, 1):
        line = [k, r['adm'], r['first'], r['middle'], r['last'], r['sex']]
        for g in r['guardians']:
            line += list(g)
        line += [None] * (6 + 3 * n - len(line))
        if extra_class:
            line.append(r['class'])
        ws.append(line)
    widths = [6, 14, 14, 14, 16, 6] + [30, 13, 14] * n + ([10] if extra_class else [])
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[ws.cell(1, i).column_letter].width = w
    for i in range(n):
        col = 6 + 3 * i + 2  # phone column
        for row in ws.iter_rows(min_row=2, min_col=col, max_col=col):
            for c in row:
                c.number_format = '@'
    ws.freeze_panes = 'A2'
    ws.auto_filter.ref = ws.dimensions
    help_ = wb.create_sheet('How to fill')
    help_.column_dimensions['A'].width = 110
    help_.append(['How to fill this file'])
    help_['A1'].font = Font(bold=True, size=13)
    for t in HOW:
        help_.append([t])
    wb.save(path)


everyone = []
for name, code in CLASSES:
    rows = sorted(students[name], key=lambda r: (r['first'], r['middle'], r['last']))
    for i, r in enumerate(rows, 1):
        r['adm'] = f'MSB-{code}-{i:04d}'
        r['class'] = name
    write_class(f'Musabe_{name}_Students.xlsx', rows)
    everyone += rows
    print(name, len(rows), 'students, up to', max(len(r['guardians']) for r in rows), 'guardians')

write_class('../test-data/2000-students-guardian-template.xlsx', everyone, extra_class=True)
families = {}
for r in everyone:
    families.setdefault(r['guardians'][0][1], []).append(r)
print('families:', len(families), '| with 2+ children:', sum(1 for v in families.values() if len(v) > 1),
      '| people:', len(used_phones))
