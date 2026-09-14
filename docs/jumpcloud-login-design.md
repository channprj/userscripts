# JumpCloud Login Assistant 0.3.0 설계

## 목표와 변경된 보안 계약

`https://console.jumpcloud.com/login#/`의 User Login에서 Tampermonkey에 저장한 계정으로 이메일 → 비밀번호 단계를 진행한다. 사용자의 잠금 암호 제거 요청에 따라 ID/PW만 한 번 등록하고 이후 활성화된 새 로그인 페이지에서 자동 진행한다. MFA는 직접 완료한다.

ID/PW를 소스·Git에 넣지 않는 요구사항은 유지한다. **GM 저장소에는 ID/PW를 평문으로 보관한다. 저장 데이터 유출에 대한 암호화 보호는 제공하지 않는다.** `0.2.0`의 잠금 암호 UI, PBKDF2/AES-GCM, 키 유도·복호화 기능은 제거했다. 키를 코드나 GM에 함께 저장하는 우회 암호화도 사용하지 않는다.

한 계정만 저장한다. 기본 상태는 비활성화이며 설정의 **저장 후 자동 로그인**으로 활성화한다. 관리자 로그인, 외부 IdP, 비밀번호 재설정, 가입, MFA 등록, 다른 데이터 센터와 SSO/OAuth 특수 경로는 범위 밖이다. 다른 userscript의 동작은 변경하지 않는다.

## 저장소와 노출 범위

| 위치 | 내용·경계 |
| --- | --- |
| userscript 소스·Git | 실제 사용자 ID/PW 없음. 테스트에는 `.test` 가상 계정만 사용. |
| GM `enabled` | 자동 진행 사용 여부 boolean. |
| GM `credentials` | `{email: string, password: string}` 평문. 이메일·비밀번호 외 필드는 허용하지 않음. |
| GM `vault` | `0.2.0`에서 남은 암호문 감지·제거용. 새로 생성하거나 복호화하지 않음. |
| 페이지 메모리·폼 | 실행에 필요한 ID/PW 원문. 스크립트 참조 해제와 미제출 입력 정리를 수행하나 완전한 메모리 소거는 보장하지 않음. |
| 전용 localStorage | `chann.jumpcloud-login-assistant.attempts.v1`에 `{email?: number, password?: number}` 제출 시각만 기록. |

GM 저장 API는 해당 userscript의 값을 저장·조회한다. 웹페이지 localStorage에 ID/PW를 넣거나 GM API를 페이지 전역으로 노출하지 않는다. Tampermonkey 대시보드의 Storage 탭에서는 저장된 값을 직접 조회·수정할 수 있다. [GM API](https://www.tampermonkey.net/documentation.php?locale=en&q=GM_values), [grant](https://www.tampermonkey.net/documentation.php?locale=en&q=grant), [Storage 탭](https://www.tampermonkey.net/faq.php?q=Q400)

이 구현에서 예상되는 주요 보안 위험은 다음과 같다.

- 저장 데이터나 이를 포함한 브라우저 프로필·백업이 유출되면 평문 ID/PW를 읽을 수 있다. 별도 암호화 장벽이 없다.
- userscript가 변조되면 GM 값을 읽는 기존 권한으로 ID/PW에 접근할 수 있다. 현재 코드의 네트워크·로그 부재는 변조된 미래 코드에 대한 보장이 아니다.
- 로그인 폼의 원문은 페이지 코드가 접근할 수 있다. 설정 창의 closed Shadow DOM은 우발적 폼 이벤트 충돌을 줄이며 악성 코드로부터 격리하는 장치는 아니다.
- 동기화·내보내기·클라우드 및 OS 백업 여부는 이 스크립트가 검사하거나 강제하지 않는다. 로컬 전용 사용자는 해당 설정을 관리해야 한다. 삭제 메뉴는 백업·원격 사본을 지우지 않는다. [Tampermonkey 내보내기](https://www.tampermonkey.net/faq.php?q=Q106)

현재 코드에는 자체 네트워크 요청, 외부 라이브러리, 원문 로그·클립보드·파일 출력이 없다. 인증 API를 직접 호출하지 않으며 쿠키·세션 토큰·JumpCloud 자체 저장 키·Vue 내부 상태를 조회하지 않는다. OS Keychain이나 전문 암호 관리자와 같은 암호화·사용자 인증 수준을 주장하지 않는다.

## 설정과 이전 버전 전환

1. 매니저의 **로그인 정보 설정** 메뉴에서 현재 실행을 중지하고 빈 이메일·비밀번호 입력란을 연다. 기존 원문은 설정 창에 미리 표시하지 않는다. 평문 보관과 동기화 설정을 안내한다.
2. 이메일 형식·최대 254자, 비밀번호 1~1024자를 검증한다. 이메일 앞뒤 공백은 제거하고 비밀번호는 입력 그대로 사용한다. 페이지·경로·설정 창이 여전히 유효한지 확인한다.
3. 저장 전 입력란을 비운 뒤 `enabled=false` → `credentials` 저장 → 이전 `vault` 삭제 → `enabled=true` 순서로 적용한다. 모두 끝나면 창을 닫고 현재 페이지의 자동 진행을 시작한다. 저장 중 실패하면 자동 진행을 시작하지 않고 설정 적용 실패를 안내한다. 다중 키 저장을 원자적 트랜잭션으로 주장하지 않는다.
4. 이전 `vault`가 있으면 활성화 여부와 새 `credentials` 존재 여부에 관계없이 재등록을 안내하고 자동 제출을 막는다. 기존 암호문은 업데이트 시 임의로 지우지 않고 새 ID/PW 저장 이후에만 제거한다. 복호화 키가 없으므로 기존 값을 자동 이전하지 않는다.
5. 새 ID/PW 저장 실패 시 이전 암호문이 유지된다. 새 값 저장 후 이전 암호문 삭제가 실패하면 자동 진행은 비활성화된 채로 남으며, 사용자가 토글해도 이전 암호문 검사에서 차단한다.
6. 취소·Escape·탭 숨김·경로 이탈 시 입력란을 비우고 설정 창을 닫는다. 닫힌 창의 제출 이벤트는 저장이나 로그인을 시작하지 못한다.
7. **저장 정보 삭제**는 확인 후 자동 진행을 끄고 `credentials`, `vault`를 삭제한다. 실패를 성공으로 안내하지 않는다. 다른 탭에서도 중지하거나 새로고침해 변경·삭제를 반영해야 한다.

## 확인한 JumpCloud 인터페이스

2026-09-14 공개 페이지의 값 없는 DOM 속성과 공개 로그인 번들 v0.232.0을 확인했다. 실제 계정 로그인과 자격증명 조회는 하지 않았다.

- 이메일: `input[name="email"][type="email"][required]`, POST 폼. fieldset과 선택적인 Remember me 체크박스가 있다.
- 공식 버튼: `button[data-automation="loginButton"][type="submit"]`.
- 비밀번호: `input[name="password"][type="password"][required]`. 빈 값이면 버튼이 disabled이며 같은 폼에 숨겨진 readonly 이메일 입력이 있다.
- Vue가 입력과 제출을 소유한다. native input setter와 `input` / `change` 이벤트로 값을 전달한다.
- Enter는 native form submit 없이 처리될 수 있다. 수동 Login 클릭·Enter 시 자동화를 중지하되 제출된 비밀번호는 유지한다.

알려진 구조가 바뀌면 입력란·버튼을 추측하지 않는다. [User Portal 안내](https://jumpcloud.com/support/get-started-user-portal), [확인한 공개 번들](https://cdn03.jumpcloud.com/jumpcloud-login-ui/v0.232.0-16bc982eb6f40a8abc339a8f74780e8b6aaa99ab/jumpcloud-login.dcf650ec.js)

## 로그인 진행과 중단

1. 최상위 프레임, 정확한 HTTPS origin과 `/login` 또는 `/login/`를 검사한다. hash는 없음·`#`·`#/`, query는 없거나 `step=password` 하나만 허용한다.
2. 이전 암호문이 없고 `enabled=true`이면 새 페이지에서 `credentials`를 읽고 형식을 검사한다. ID/PW가 있으면 현재 실행용 객체에 복사한다. 새 값도 이전 암호문도 없을 때만 기존 외부 암호 관리자 자동완성 모드를 허용하며 이 모드는 원문을 읽지 않는다.
3. 활성 탭이며 document에 포커스가 있을 때만 입력·제출한다. MutationObserver와 500ms polling을 사용하며 실행 수명은 최대 2분이다.
4. 표시된 폼과 공식 버튼이 각각 하나여야 한다. POST, 현재 프레임 대상, 동일 출처 form action만 허용한다. OTP, 새 비밀번호, 추가 입력, 외부 action, base 태그, 다른 submit method 등 알 수 없는 구조는 거부한다.
5. 저장 모드는 빈 필드를 채우며 다른 이메일·비밀번호가 이미 있으면 덮어쓰지 않고 중지한다. 비밀번호 입력 전 같은 폼의 readonly 이메일 하나가 저장 계정과 일치해야 한다. 계정 비교 시 이메일 공백과 대소문자를 정규화한다.
6. 비밀번호가 비어 버튼이 disabled여도 입력은 가능하다. native validity가 유효하고 버튼이 활성화된 상태가 1초 유지되면 제출을 준비한다. 입력 이벤트 재진입을 막고 안정화 시간을 다시 계산한다.
7. Web Locks exclusive lock 안에서 경로·활성 상태·폼·MFA·알림·계정·설정을 다시 확인한다. 전용 localStorage에 제출 시각을 기록한 다음 공식 버튼을 클릭한다. 잠금·기록 실패 시 제출하지 않는다. GM 캐시의 탭 간 지연에 의존하지 않는다. [Web Locks 명세](https://www.w3.org/TR/web-locks/)
8. 단계별로 한 번만 자동 제출한다. 같은 단계의 최근 10분 제출은 제한하며, 비밀번호 제출 기록은 두 단계 모두 제한한다. 이메일 이후 비밀번호는 진행할 수 있다. 시간 경과가 재시도를 일으키지는 않는다.
9. 비밀번호 제출·오류·MFA·직접 입력·수동 제출·Escape·숨김·경로 이탈 시 실행을 중지하고 원문 참조를 해제한다. 아직 제출하지 않은 스크립트 입력 비밀번호가 그대로 남아 있으면 지운다. 사용자 수정값·제출값은 유지한다.
10. 중지는 GM의 ID/PW를 삭제하지 않는다. **다시 시도**는 활성화된 경우 제출 제한을 초기화하고 저장 정보로 재개한다. 다음 새 로그인 페이지도 활성화 설정을 따르며 잠금 해제는 필요하지 않다.

전용 localStorage 기록은 페이지에서도 변경 가능한 비민감 중복 방지 데이터다. 인증 보안 경계로 사용하지 않는다. 비밀번호 단계를 제출한 뒤 실제 로그인 성공으로 추정하지 않으며 MFA와 결과는 사용자가 확인한다.

## 검증

Node.js test runner와 기존 jsdom만 사용하며 신규 의존성은 없다. 저장 모드에서는 가상 GM 값과 자동 입력을 대조한다. 외부 자동완성 모드는 입력 원문 getter를 차단한다. 두 모드 모두 폼 직렬화·로그·쿠키·자체 네트워크·클립보드·sessionStorage·페이지 전체 HTML/텍스트 조회를 차단한다.

JumpCloud 85개와 전체 183개 테스트, 문법·공백 검사가 통과했다. 잠금 입력 없는 저장·새 페이지 로그인, 이전 암호문 재등록·실패, 부적합 설정 거부, 계정 불일치, 설정 취소·삭제, 수동 제출, 탭 경쟁과 반복 제출 제한을 검증했다. 원문 로그와 Web Storage 복사를 하지 않는다는 점도 테스트 경계에서 확인했다.

실제 Tampermonkey UI에서 계정 등록·자동 입력·MFA·포털 진입까지의 통합 검증은 미실행이다. jsdom 테스트는 실제 확장 프로그램 환경·브라우저 암호 관리자 간섭·현재 페이지 동작을 대신하지 않는다. 실제 ID/PW는 개발 과정에서 조회·입력·저장하지 않았다.
