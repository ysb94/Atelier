/**
 * 채팅 파일 규칙 검증.
 * 실행: npm run verify:chat-files
 */
import {
  CHAT_FILE_MAX_BYTES,
  chatDownloadFileName,
  chatFileBlockReason,
  chatFileHasMacro,
} from './file-rules'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

assert(
  chatFileBlockReason({ name: 'virus.exe', size: 10 }) ===
    '실행 파일은 올릴 수 없습니다.',
  'exe 차단',
)
assert(
  chatFileBlockReason({ name: 'photo.jpg.exe', size: 10 }) ===
    '실행 파일은 올릴 수 없습니다.',
  '끝 확장자가 exe면 차단',
)
assert(
  chatFileBlockReason({ name: 'file.exe.jpg', size: 10 }) === null,
  '가운데 exe는 그림으로 허용',
)
assert(
  chatFileBlockReason({ name: 'script.js', size: 10 }) !== null,
  'js 차단',
)
assert(
  chatFileBlockReason({ name: 'setup.PS1', size: 10 }) !== null,
  '대문자 확장자도 차단',
)
assert(chatFileBlockReason({ name: '보고서.pdf', size: 1200 }) === null, 'pdf 허용')
assert(
  chatFileBlockReason({ name: 'book.xlsm', size: 800 }) === null,
  '매크로 엑셀은 허용',
)
assert(chatFileHasMacro('book.xlsm'), 'xlsm은 매크로')
assert(chatFileHasMacro('매크로.XLS'), 'xls는 매크로')
assert(!chatFileHasMacro('plain.xlsx'), 'xlsx는 매크로 아님')
assert(!chatFileHasMacro('file.exe.jpg'), 'jpg는 매크로 아님')
assert(
  chatFileBlockReason({ name: 'big.bin', size: CHAT_FILE_MAX_BYTES + 1 }) !==
    null,
  '50MB 초과 차단',
)
assert(
  chatFileBlockReason({ name: 'edge.bin', size: CHAT_FILE_MAX_BYTES }) === null,
  '50MB는 허용',
)
assert(chatFileBlockReason({ name: 'empty.txt', size: 0 }) !== null, '빈 파일 차단')
assert(chatFileBlockReason({ name: '   ', size: 10 }) !== null, '빈 이름 차단')
assert(
  chatFileBlockReason({ name: `${'가'.repeat(181)}.txt`, size: 10 }) !== null,
  '180자 초과 차단',
)
assert(chatFileBlockReason({ name: '이름없음', size: 10 }) === null, '확장자 없는 파일 허용')
assert(
  chatDownloadFileName('보고서 (최종).xlsx') === '보고서 (최종).xlsx',
  '한글 파일 이름은 그대로',
)
assert(chatDownloadFileName('a/b:c.txt') === 'a_b_c.txt', '경로 문자는 밑줄')
assert(chatDownloadFileName('  공백.txt  ') === '공백.txt', '앞뒤 공백 제거')
assert(chatDownloadFileName('...') === '파일', '이름만 점이면 기본 이름')

console.log('chat file rules ok')
