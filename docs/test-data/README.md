# Test data: items, opening stock and students

## Student guardian workbook

- `2000-students-guardian-template.xlsx` contains 2,000 fictional student rows and the exact student/guardian columns supported by the class-list template.
- Every row has the primary parent DANIEL MUSABE DAMIAN as Father and a second Guardian 1 as Mother or Guardian.
- Guardian 2 and Guardian 3 are optional and included only on some rows.
- Parent and guardian phone cells are text-formatted Tanzanian 10-digit numbers beginning 06 or 07.

# Test data: items and opening stock

Load in this order:

1. **1-items-for-sale-and-prices.xlsx** (uniform, socks, exercise books…) — Finance Manager: *Items & prices → Upload Excel → Approve*.
2. **2-items-to-issue.xlsx** (text books, reams, chalk, lab instruments, food) — Store-keeper or Finance Manager: *Items to issue → Upload Excel*.
3. **3a / 3b / 3c opening stock** (one per school) — Finance office: *Send stock → choose the school → Upload Excel → Check and send*. Then the librarian of that school confirms on *Incoming stock*.

After that:
- Sell: bursar writes a receipt → the librarian scans the student ID (or the receipt) and the QR on each thing.
- Issue: the librarian scans the ID, then the books / reams.
- Print QR labels: Store-keeper on *QR labels & ID cards*, or *Print QR labels* on a purchase / delivery.
