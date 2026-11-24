# Built-in syllabi (read from the TIE PDFs)

`backend/src/data/syllabus-2027-primary.json` is made from the official TIE syllabus PDFs in `docs/curriculum/`.
Migration 043 loads it into `syllabi`, `syllabus_topics` (specific competences) and `syllabus_items` (learning activities).

To make it again (Python 3 with `pdfplumber`, and `pdftotext` from poppler):

```
pip install pdfplumber
python pre.py      # pre-primary (its tables are turned sideways, so it is read as laid-out text) -> pre.json
python build.py   # all primary syllabi -> ../../src/data/syllabus-2027-primary.json
```

`build.py` prints, for each syllabus, the topics per class and the periods per year (a check: Mathematics = 234 = 6 a week).
Kiswahili, Historia ya Tanzania, Chinese and Arabic are kept in Kiswahili (the Kiswahili part only).
Next: the secondary syllabi (Form I–IV) and the "2026 and before" Std VII syllabi.
