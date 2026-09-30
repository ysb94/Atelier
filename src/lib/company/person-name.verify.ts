/**
 * 본명 정규화·형식 검증.
 * 실행: npx tsx src/lib/company/person-name.verify.ts
 */
import {
  normalizePersonName,
  personInitials,
  personNameError,
  validatePersonName,
} from './person-name'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const allowed = [
  '홍길동',
  'Jean Luc Picard',
  'Jean-Luc Picard',
  "O'Connor",
  'O’Connor',
  'José García',
  '山田 太郎',
  '山田太郎',
  'やまだ たろう',
  '김.철수',
]

for (const name of allowed) {
  assert(personNameError(name) === null, `허용해야 함: ${name}`)
  assert(validatePersonName(`  ${name}  `) === name, `공백 정규화: ${name}`)
}

assert(
  normalizePersonName('홍  길동') === '홍 길동',
  '연속 공백은 하나로',
)
assert(validatePersonName('ＡＢ') === 'AB', '전각 영문 NFKC')
assert(
  personNameError(normalizePersonName('Ｊｏｓｅ')) === null,
  '전각 라틴은 NFKC 뒤 허용',
)

const rejected = ['', ' ', '김', '개발자1', 'dev@example.com', '홍길동😀', '홍_길동']
for (const name of rejected) {
  assert(personNameError(name) !== null, `거부해야 함: ${name || '(빈 값)'}`)
  let threw = false
  try {
    validatePersonName(name)
  } catch {
    threw = true
  }
  assert(threw, `validate는 예외: ${name || '(빈 값)'}`)
}

assert(personInitials('김지선') === '지선', '한글 세 글자는 성을 뺀다')
assert(personInitials('김민') === '김민', '한글 두 글자는 그대로')
assert(personInitials('홍') === '홍', '한글 한 글자는 그대로')
assert(personInitials('Jean Luc') === 'JL', '영문 두 단어는 앞 글자')
assert(personInitials('Jean') === 'J', '영문 한 단어는 첫 글자')
assert(personInitials('山田太郎') === '山', '한글·영문이 아니면 첫 글자')
assert(personInitials('') === '?', '빈 이름')
assert(personInitials(null) === '?', '이름 없음')

console.log('person-name.verify ok')
