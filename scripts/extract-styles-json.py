import json
from pathlib import Path

raw = Path(
    r"C:\Users\dbstj\.cursor\projects\c-Users-dbstj-OneDrive-Masmarulez-Atelier\agent-tools\dfd00042-6000-47e2-b4ed-c6acd10ce70e.txt"
).read_text(encoding="utf-8")
payload = json.loads(raw)
text = payload["result"]
start = text.find("[")
end = text.rfind("]")
rows = json.loads(text[start : end + 1])
out = Path(r"node_modules/.tmp/masmarulez-styles.json")
out.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
print(len(rows), rows[0])
