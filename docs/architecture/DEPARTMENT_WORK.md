# 부서 업무

기획·Visual·MD·물류의 `/work-requests/:owner`는 부서 전체 목록이다. My home 작업 요청 공개 여부는 바꾸지 않는다. 기존 주소와 `requestId`, `mode`는 유지하고, `aux=1`은 기존 일정표·작업 처리, `internal=1&mode=new`는 자체 업무 입력이다.

## 조회와 권한

- 부서 UUID가 일치하는 같은 회사의 활성 직원과 기존 예외 세 계정만 부서 목록을 조회한다. 공지는 기존 department 공지와 작성 권한을 사용한다.
- 목록 RPC `list_department_work`는 제목·사람·상태·날짜·브랜드만 반환한다. `get_department_work`로 상세를 열 때 본문·준비 완료된 첨부를 읽는다.
- 부서 전체 조회는 별도의 SELECT 정책으로 추가한다. 기존 `work_request_read`, `work_message_read`, 관리 판정, 저장·배정·취소 권한은 확대하지 않는다. 업무 대화는 기존 참여자만 조회·작성한다.
- 계정 UUID를 쿼리 키에 포함하며 계정 전환 시 화면 필터도 초기화한다. 실시간 변경과 재접속 시 목록을 갱신한다.

## 자체 업무

`work_requests.kind`는 request(기존 요청) 또는 internal이다. 기존 요청 내용·상태는 일괄 수정하지 않는다. `begin_department_work`로 본인의 초안을 생성하고, `save_department_work`가 기존 저장 검증과 본인 배정·진행 시작을 한 트랜잭션에서 처리한다. 자동 분류 담당자는 자체 업무에 적용하지 않는다.

본인이 등록하고 현재 담당하는 자체 업무만 `complete_department_work`로 완료한다. 기존 revision 검사와 명령 UUID로 중복 처리를 방지하고 종료 시 실행 중인 시간을 마감한다. 타인에게 재배정된 업무는 기존 완료 검수를 따른다. 기존 받은 요청의 접수·분류 자동 배정·완료 검수는 유지한다.

## 필터와 검증

기본은 미종료 팀 업무이며, 요청 부서별로 묶고 마감일 오름차순으로 정렬한다. 요청자·담당자·상태·브랜드 필터는 같은 항목 내 OR, 항목 간 AND로 적용한다. 담당자는 주 담당·협업자·분류 담당자를 중복 없이 포함한다. 상태를 명시하면 완료·취소·반려도 조회할 수 있다.

검증: `npm run verify:department-work`, `npm run verify:department-work-browser`, 기존 관리자·URL·공개 범위 검증, Node 22 빌드. 브라우저 검증은 로컬 PGlite와 가짜 API만 사용하고 운영 네트워크를 차단한다.

## 적용 상태

`20261102093634_department_work_board.sql`은 로컬 검증용으로 준비했다. 공유 DB 적용은 사용자 별도 승인 후 진행한다. DB 적용 전 실제 로컬 사이트의 새 조회·등록은 연결 대기 상태일 수 있다. test·main 배포는 포함하지 않는다.
