# JumpCloud 로그인 자동 진행 설계

## 목표와 범위

`https://console.jumpcloud.com/login#/`의 이메일 → 비밀번호 단계를 자동으로 진행한다. ID/PW는 사용자가 선택한 로컬 암호 저장소에서 관리한다. userscript에는 ID/PW 입력 UI, 원문, 암호문, 암호화 키, 계정 식별자 설정이 없다. MFA는 사용자가 완료한다.

대상은 현재 URL의 User Login이다. Administrator Login, 외부 IdP, 비밀번호 재설정, 가입, MFA 등록, SSO/OAuth 특수 경로는 자동화하지 않는다. 기존 userscript에는 변경을 가하지 않는다. 초기 상태는 비활성화이며 암호 관리자 설정 후 매니저 메뉴에서 활성화한다.

## 보안 계약

- userscript는 입력 컨트롤의 `value`, `defaultValue`, `value` 속성, 폼 직렬화, 이벤트의 입력 데이터, 페이지 전체 텍스트/HTML, Vue 상태를 읽거나 쓰지 않는다.
- ID/PW를 네트워크, 로그, 클립보드, 파일, GM 저장소, Web Storage에 복사하지 않는다. 자체 네트워크 요청과 외부 라이브러리가 없다.
- 필요한 값은 필드 종류, 이름, required/validity, 활성/표시 상태와 공식 로그인 버튼의 식별자뿐이다. 문자열 원문 없이 입력 완료 여부만 판정한다.
- GM 저장소에는 활성화 boolean과 단계별 제출 시각만 저장한다. 계정, URL, 쿠키, 토큰은 기록하지 않는다.
- 로그인 제출은 JumpCloud의 기존 버튼 `click()`을 통해 JumpCloud가 수행한다. 인증 API, 쿠키, CSRF, MFA 처리에 개입하지 않는다.
- 이 계약은 **이 스크립트가 비밀번호를 취급하지 않는다**는 보장이다. DOM에 자동 입력된 값을 페이지 코드, 다른 확장 프로그램, 변조된 userscript가 읽을 수 없다는 접근 통제는 아니다. 그러한 절대 격리가 필요하면 비밀번호 폼 자동화 대신 조직에서 지원하는 패스키/JumpCloud Go가 필요하다.
- 브라우저와 암호 관리자의 잠금, 암호화, 동기화 정책은 해당 제품의 책임이다. 스크립트가 로컬 보관 여부를 검사하거나 강제하지 않는다. 로컬 전용 요구사항을 만족하려면 클라우드 저장/동기화를 사용하지 않는 구성을 사용자가 선택해야 한다.

## 대안 비교

| 방식 | 자격증명 경로 | 판단 |
| --- | --- | --- |
| 로컬 암호 관리자 + 진행 전용 userscript | 저장소 → 브라우저/암호 관리자 → JumpCloud 폼 | 채택. 새 자격증명 보관/전송 시스템이 필요 없다. |
| macOS Keychain + 로컬 서버 | Keychain → 로컬 HTTP → userscript → 폼 | 배제. 원문이 userscript 런타임에 전달되고 로컬 서버 인증/허용 출처 관리가 필요하다. |
| GM 저장소 암호화 | 암호문/복호화 키 → userscript → 폼 | 배제. 키 관리가 추가되며 스크립트가 원문을 다룬다. |

## 확인한 외부 인터페이스

2026-09-14 실제 공개 페이지와 공개 로그인 번들 v0.232.0을 조회했다. 실제 로그인과 사용자 자격증명 조회는 하지 않았다.

- User Login 이메일 필드: `input[name="email"][type="email"][required]`, `autocomplete="on"`, 폼 method POST.
- 공식 진행 버튼: `button[data-automation="loginButton"][type="submit"]`.
- UserPasswordEntry 공개 컴포넌트: `input[name="password"][type="password"][required]`, 비밀번호가 없으면 버튼 disabled. 같은 폼에 숨겨진 readonly 이메일 필드가 존재한다.
- Vue 컴포넌트가 입력과 전환을 소유한다. 사용자가 직접 입력하면 자동 진행을 중단하고, 암호 관리자 입력은 안정화 시간을 거친다. `:autofill`만 필수 조건으로 사용하면 일부 외부 암호 관리자의 입력을 감지하지 못하므로 required 필드의 브라우저 유효성 boolean과 버튼 상태를 사용한다.
- 직접 관찰하지 못한 비밀번호 이후 단계와 암호 관리자별 실제 자동완성은 사용자의 로컬 수동 검증이 필요하다.

## 동작과 상태

1. 정확한 HTTPS origin, `/login` 또는 `/login/`, 최상위 프레임을 확인한다. 알려진 빈 hash와 `#/`만 허용한다. query는 없거나 `step=password`만 허용한다. 그 외 인증 흐름에서는 중단한다.
2. 초기 안내에서 자격증명을 받지 않는다. 매니저 메뉴로 활성화/비활성화, 현재 페이지 중지, 명시적 다시 시도, 상태 안내를 제공한다.
3. 활성 탭이며 document에 포커스가 있는 동안만 감시한다. 한 실행은 2분 뒤 종료된다. MutationObserver와 500ms polling은 입력값 변경 이벤트가 없는 자동완성도 감지한다.
4. 표시되고 활성화된 공식 버튼이 정확히 하나이고, 같은 폼의 편집 가능한 필드가 이메일 하나 또는 비밀번호 하나인 경우만 허용한다. 비밀번호 화면의 숨겨진 readonly 이메일은 읽지 않는다. 추가 OTP, 새 비밀번호, 두 번째 폼, 알 수 없는 필드, 외부 form action, 다른 submit target은 거부한다.
5. required 입력 필드의 native validity가 유효하고 버튼이 활성화된 상태가 1초 유지되면 다음 단계로 진행한다. `input`/`change` 이벤트 발생 시 안정화 시간을 다시 계산하지만 이벤트 데이터는 읽지 않는다.
6. 직접 타이핑, 붙여넣기, composition, 수동 로그인 버튼 제출 시 이번 실행을 중단한다. 메뉴의 다시 시도로만 재개한다. 자동완성이 문자를 입력하는 방식의 도구는 수동 입력으로 취급될 수 있다.
7. Web Locks의 origin 단위 exclusive lock 안에서 상태를 다시 확인하고 GM 제출 시각을 먼저 기록한 다음 클릭한다. lock API나 GM 저장에 실패하면 제출하지 않는다.
8. 이메일·비밀번호는 실행당 각각 한 번만 제출한다. 마지막 자동 비밀번호 제출 후 10분 동안 새 실행/다른 탭도 자동 진행을 제한한다. 이메일 제출도 10분 동안 중복하지 않되 이후 비밀번호 단계는 진행할 수 있다. 시간 경과가 자동 재시도를 일으키지는 않는다. 다시 시도는 사용자의 명시적 초기화다.
9. 로그인 경로 이탈, visible 오류/경고, MFA 필드, Escape, 사용자 입력, 시간 초과에서 observer/timer를 해제하고 정적 상태만 표시한다. 비밀번호 제출 직후도 자동화를 종료한다. 로그인 성공했다고 추정하지 않는다.

## 검증

Node.js 기본 test runner + 기존 jsdom으로 공개 DOM 계약을 재현한다. 가상 ID/PW만 사용한다. 입력 원문 접근 getter와 직렬화/로그/네트워크 경계를 막은 상태에서 정상 이메일·비밀번호 전환이 작동해야 한다. 실제 브라우저 자동완성은 jsdom에서 재현하지 않았다고 명시한다.

검증 항목: 비활성 초기값, 자동완성 대기와 안정화, DOM 교체, 직접 입력 중단, 취소/재개, 숨김 탭, 잘못된 origin/route/form action, 다중/비정상 폼, MFA/오류, 중복 실행과 재로드, 여러 탭 경쟁, 저장 실패, Web Locks 미지원, 대기 중 화면 이탈, 반복 클릭 방지, 정적 안내의 정보 유출 방지. 전체 기존 테스트와 syntax check를 함께 실행한다.

## 근거

- [JumpCloud User Portal 로그인](https://jumpcloud.com/support/get-started-user-portal): 이메일, 비밀번호, MFA/JumpCloud Go 흐름.
- [Chrome 암호 관리](https://support.google.com/chrome/answer/95606?hl=en): Chrome에 로그인하지 않았을 때 장치에 로컬 저장. 계정 저장과 구분해야 한다.
- [Chrome 자동완성 이벤트](https://developer.chrome.com/blog/autofill-event-origin-trial): 입력 이벤트만으로 자동완성 출처를 구분할 수 없고 `:autofill` 지원에 차이가 있다. 원문을 제공하는 실험적 `autofillValues`는 사용하지 않는다.
