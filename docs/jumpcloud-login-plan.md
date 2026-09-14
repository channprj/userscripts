# JumpCloud Login Implementation Plan

**Goal:** 로컬 암호 관리자가 입력한 JumpCloud 로그인 폼을 ID/PW 원문 접근 없이 진행한다.

**Architecture:** 암호 관리자가 보관과 자동 입력을 소유한다. 단일 userscript가 공개 DOM 상태만 관찰하고, 중복 방지 기록 후 기존 로그인 버튼을 누른다. 테스트는 기존 Node.js/jsdom 환경을 사용한다.

**Tech Stack:** JavaScript userscript, GM boolean settings/menu API, Web Locks, origin-local timestamp storage, Node.js test runner, jsdom 30.0.1.

**Spec:** [보안 및 동작 설계](jumpcloud-login-design.md)

## Global Constraints

- 입력 원문, 이벤트 데이터, 폼 직렬화, 인증 API, 쿠키에 접근하지 않는다.
- ID/PW는 사용자가 로컬 암호 관리자에서 직접 설정한다.
- MFA와 `/login` 밖의 인증 흐름은 자동화하지 않는다.
- 자동 진행은 초기 비활성화, 활성 탭에서만 실행한다.
- Node.js `^22.22.2 || ^24.15.0 || >=26.0.0`, 신규 의존성 없음.
- 사용자 요청 `gcpr`에 따라 현재 main에서 명시적 파일 staging 후 일반 push. 작업 전 변경 없음, origin/main과 0/0 동기화 확인.

## Checkpoint 1: 설계 계약

- [x] 공개 페이지에서 값 없는 DOM 속성 확인 및 공개 번들로 password 단계 확인.
- [x] 보관 대안, 보안 경계, 실패 조건, 검증 범위를 spec에 기록.
- [x] 문서의 모순/불명확한 범위/미정 사항 점검.
- [x] `git diff --check` 후 두 설계 문서를 `docs(jumpcloud): define credential-free login automation`으로 커밋·푸시하고 upstream 0/0 확인.

## Checkpoint 2: 진행 기능과 보안 테스트

**Files:** `jumpcloud-login-assistant.user.js`, `test/jumpcloud-login-assistant.test.js`, `package.json`.

**Interfaces:** GM에는 `enabled: boolean`만 저장한다. origin의 `chann.jumpcloud-login-assistant.attempts.v1` 키에는 `{email?: number, password?: number}` 제출 시각만 JSON으로 저장한다. `button[data-automation="loginButton"]`의 소유 form에서 `email` 또는 `password` required 입력 하나를 찾는다. 외부 export/API/설정 파일은 만들지 않는다.

- [x] 테스트 harness에서 실제 script를 평가하고 `click`의 단계만 수집한다. window 타이머와 `Date.now()`를 가상 시계로, Web Locks/GM/전용 제출 기록만 외부 경계로 대체한다. input의 원문 getter는 예외를 발생시키되 DOM의 실제 validity 검사는 유지한다.
- [x] 아래 핵심 assertion이 미구현 상태에서 실패함을 확인한다.

  ```js
  const h = setup(t, { enabled: true });
  h.fill('email', 'fixture@example.test');
  await h.advance(1500);
  assert.deepEqual(h.clicks, ['email']);
  h.passwordStep();
  h.fill('password', 'fixture-only-password');
  await h.advance(1500);
  assert.deepEqual(h.clicks, ['email', 'password']);
  assert.deepEqual(h.sensitiveAccesses, []);
  ```

- [x] strict route/form selector, validity 안정화, static notice/메뉴, 실행 수명, 수동 입력 중단, lock+cooldown 순서로 구현한다. 재평가 시 부적합 조건이 하나라도 있으면 클릭하지 않는다.
- [x] spec 검증 목록을 표 기반 실패 테스트로 확장하고 보안 회귀를 통과시킨다. source 텍스트 검색만으로 보안 통과를 주장하지 않는다. 58개 JumpCloud 테스트에서 원문 접근 차단 및 다중 탭/비동기 중단 조건을 검증했다.
- [x] `package.json`의 check 명령에 새 userscript의 `node --check`를 추가한다.
- [x] `node --test test/jumpcloud-login-assistant.test.js`, `npm test`, `npm run check`, `git diff --check`를 실행한다.
- [x] diff 전체 및 실제 자격증명 유입 여부 검토 후 `feat(jumpcloud): advance login without reading credentials` 커밋·푸시, upstream 0/0 확인.

## Checkpoint 3: 설치·운영 안내

**Files:** `README.md`, `docs/jumpcloud-login-design.md`, 이 계획 문서.

- [x] 설치 표에 버전 `0.1.0` 및 `https://raw.githubusercontent.com/channprj/userscripts/main/jumpcloud-login-assistant.user.js`를 추가한다.
- [x] 로컬 보관 설정, 사용자 직접 저장, 자동완성 후 활성화, MFA 완료, 중지/재시도/삭제 절차를 설명한다.
- [x] 클라우드 동기화와 암호 관리자별 입력 방식 차이, DOM 비밀 격리 한계, 실제 계정 E2E 미실행을 명시한다.
- [x] 실제 코드와 문서의 설정 키/메뉴/제한을 대조하고 계획의 완료 체크를 갱신한다.

최종 문서 commit은 `docs(jumpcloud): explain local vault setup and login controls`로 발행한다. 문서 검토와 `git diff --check`를 거친 뒤 일반 push 및 upstream 0/0 확인 결과를 최종 응답에 기록한다.

## 검증 기록

- `65b7336`: 설계 문서 검토, 공백 검사 후 푸시 완료.
- `6fddc35`: 전체 `npm test` 156/156, `npm run check`, `git diff --check` 통과 후 푸시 완료.
- 핵심 기능 미구현 시 실패를 확인했고, GM 캐시 지연·늦은 MFA·재시도 저장 오류도 실패 재현 후 수정했다.
- 실제 로그인 페이지에서 값 없는 DOM 계약을 확인했다. 실제 ID/PW, 암호 저장소 및 인증 세션은 조회·변경하지 않았으며 실제 계정 E2E는 실행하지 않았다.
