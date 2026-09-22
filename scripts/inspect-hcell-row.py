import re
import zipfile

z = zipfile.ZipFile(r"node_modules/.tmp/sabangnet-official.xlsx")
ss = z.read("xl/sharedStrings.xml").decode("utf-8")
sheet = z.read("xl/worksheets/sheet1.xml").decode("utf-8")

# find shared string index of 100050
si_re = re.compile(r"<(?:x:)?si\b[^>]*>([\s\S]*?)</(?:x:)?si>")
items = []
for block in si_re.findall(ss):
    texts = re.findall(r"<(?:x:)?t\b[^>]*>([\s\S]*?)</(?:x:)?t>", block)
    items.append("".join(texts))

idx = items.index("100050")
print("shared index", idx)

# find the cell that references this shared string
cell = re.search(rf'<(?:x:)?c r="A(\d+)"[^>]*>\s*<(?:x:)?v>{idx}</(?:x:)?v>', sheet)
print("cell", cell.group(0) if cell else None, "row", cell.group(1) if cell else None)
if cell:
    row_no = cell.group(1)
    row = re.search(rf'<(?:x:)?row r="{row_no}"[\s\S]*?</(?:x:)?row>', sheet)
    body = row.group(0) if row else ""
    print("row cells A-D:")
    for found in re.findall(r'<(?:x:)?c r="([A-D])' + row_no + r'"([^>]*)>([\s\S]*?)</(?:x:)?c>', body):
        print(found)
    print("shared 5334", repr(items[5334]) if len(items) > 5334 else "missing")
