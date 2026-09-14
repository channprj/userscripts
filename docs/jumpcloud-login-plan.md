# JumpCloud Login Implementation Plan

**Goal:** 로컬 암호 관리자가 입력한 JumpCloud 로그인 폼을 ID/PW 원문 접근 없이 진행한다.

**Architecture:** 암호 관리자가 보관과 자동 입력을 소유한다. 단일 userscript가 공개 DOM 상태만 관찰하고, 중복 방지 기록 후 기존 로그인 버튼을 누른다. 테스트는 기존 Node.js/jsdom 환경을 사용한다.

**Tech Stack:** JavaScript userscript, GM synchronous storage/menu API, Web Locks, Node.js test runner, jsdom 30.0.1.

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
- [ ] `git diff --check` 후 두 설계 문서를 `docs(jumpcloud): define credential-free login automation`으로 커밋·푸시하고 upstream 0/0 확인.

## Checkpoint 2: 진행 기능과 보안 테스트

**Files:** `jumpcloud-login-assistant.user.js`, `test/jumpcloud-login-assistant.test.js`, `package.json`.

**Interfaces:** GM에는 `enabled: boolean`, `attempts: {email?: number, password?: number}`만 저장한다. `button[data-automation="loginButton"]`의 소유 form에서 `email` 또는 `password` required 입력 하나를 찾는다. 외부 export/API/설정 파일은 만들지 않는다.

- [ ] 테스트 harness에서 실제 script를 평가하고 `click`의 단계만 수집한다. window 타이머와 `Date.now()`를 가상 시계로, Web Locks/GM만 외부 경계로 대체한다. input의 원문 getter는 예외를 발생시키되 DOM의 실제 validity 검사는 유지한다.
- [ ] 아래 핵심 assertion이 미구현 상태에서 실패함을 확인한다.

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

- [ ] strict route/form selector, validity 안정화, static notice/메뉴, 실행 수명, 수동 입력 중단, lock+cooldown 순서로 구현한다. 재평가 시 부적합 조건이 하나라도 있으면 클릭하지 않는다.
- [ ] spec 검증 목록을 표 기반 실패 테스트로 확장하고 보안 회귀를 통과시킨다. source 텍스트 검색만으로 보안 통과를 주장하지 않는다.
- [ ] `package.json`의 check 명령에 새 userscript의 `node --check`를 추가한다.
- [ ] `node --test test/jumpcloud-login-assistant.test.js`, `npm test`, `npm run check`, `git diff --check`를 실행한다.
- [ ] diff 전체 및 실제 자격증명 유입 여부 검토 후 `feat(jumpcloud): advance login without reading credentials` 커밋·푸시, upstream 0/0 확인.

## Checkpoint 3: 설치·운영 안내

**Files:** `README.md`, 이 계획 문서.

- [ ] 설치 표에 버전 `0.1.0` 및 `https://raw.githubusercontent.com/channprj/userscripts/main/jumpcloud-login-assistant.user.js`를 추가한다.
- [ ] 로컬 보관 설정, 사용자 직접 저장, 자동완성 후 활성화, MFA 완료, 중지/재시도/삭제 절차를 설명한다.
- [ ] 클라우드 동기화와 암호 관리자별 입력 방식 차이, DOM 비밀 격리 한계, 실제 계정 E2E 미실행을 명시한다.
- [ ] 실제 코드와 문서의 설정 키/메뉴/제한을 대조하고 계획의 완료 체크를 갱신한다.
- [ ] 문서 변경 검토와 `git diff --check` 후 `docs(jumpcloud): explain local vault setup and login controls` 커밋·푸시.
- [ ] 전체 테스트 결과, 최종 clean worktree, 시작점 `979f4fb` 이후 commit 목록과 upstream 0/0을 확인해 보고한다.
