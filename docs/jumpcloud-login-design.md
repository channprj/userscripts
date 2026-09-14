# JumpCloud Login Assistant 0.2.0 설계

## 목표와 보안 계약

`https://console.jumpcloud.com/login#/`의 User Login에서 로컬에 저장한 계정으로 이메일 → 비밀번호 단계를 진행한다. 사용자와 확인한 요구사항은 **실제 ID/PW를 userscript 소스·Git에 포함하지 않고, Tampermonkey 저장소에 암호화해 보관하는 것**이다. 설정과 로그인 시 userscript 런타임이 원문을 일시적으로 처리하며, 새 페이지에서는 사용자가 별도의 잠금 암호를 입력한다. MFA는 직접 완료한다.

기본 상태는 비활성화이며 한 계정만 저장한다. 관리자 로그인, 외부 IdP, 비밀번호 재설정, 가입, MFA 등록, 다른 데이터 센터나 SSO/OAuth 특수 경로는 범위 밖이다. GitHub Account Switcher와 기존 userscript의 동작은 변경하지 않는다.

- ID/PW는 하나의 암호문으로 저장한다. 저장소에 평문 계정 식별자, 비밀번호, 잠금 암호, 복호화 키를 남기지 않는다.
- 잠금 암호는 코드나 저장된 설정에서 얻지 않고 매번 사용자에게 받는다. 자동 잠금 해제·영구 키 저장은 제공하지 않는다.
- 자체 인증 API 호출, 쿠키·토큰 조회, 원문 로그, 클립보드·파일 출력, 외부 라이브러리와 자체 네트워크 요청은 없다. 공식 로그인 버튼을 눌러 JumpCloud가 인증 요청을 처리한다.
- 암호문을 훔친 공격자에 대한 저장 시 보호가 목적이다. 약한 잠금 암호에 대한 오프라인 추측은 막을 수 없으므로 긴 별도 암호를 사용한다.
- 사용 중인 페이지·브라우저·확장 프로그램·userscript가 침해되면 입력 중이거나 복호화된 원문을 보호할 수 없다. closed Shadow DOM은 페이지 폼과의 우발적 충돌을 줄이는 장치이며 보안 경계가 아니다.
- 바이트 버퍼는 가능한 범위에서 덮어쓰고 문자열 참조를 해제한다. JavaScript GC, 브라우저 폼, 페이지 모델, 메모리 덤프에서 완전한 원문 소거를 보장하지 않는다.
- Tampermonkey의 동기화·내보내기와 OS/프로필 백업 정책은 이 스크립트가 강제하지 못한다. 로컬 전용 사용자는 동기화·클라우드 백업을 끄고 외부 내보내기를 피해야 한다. 삭제 메뉴도 기존 백업이나 다른 탭의 메모리까지 삭제하지 않는다.

## 저장 방식 선택

| 방식 | 판단 |
| --- | --- |
| GM 저장소 평문 | 소스에서는 분리되지만 저장소에서 ID/PW를 바로 읽을 수 있으므로 사용하지 않는다. |
| GM 저장소 암호문 + 사용자 잠금 암호 | 채택. 기존 Tampermonkey 저장 API를 사용하고 키를 저장하지 않는다. 로그인마다 잠금 해제가 필요하다. |
| 암호문과 복호화 키를 함께 저장 | 암호문 탈취 시 보호 효과가 없으므로 사용하지 않는다. |
| OS Keychain + 로컬 서버 | 별도 프로세스·권한·전송 경로가 필요하므로 현재 범위에서 제외한다. |
| 외부 암호 관리자 자동완성 | 저장 정보를 등록하지 않은 경우에만 기존 진행 기능을 유지한다. 이 모드는 원문을 읽지 않는다. |

GitHub Account Switcher와 동일한 `GM_getValue` / `GM_setValue`로 코드와 설정을 분리하되, 비밀 데이터에는 별도 암호화를 추가한다. Tampermonkey 자체를 OS Keychain이나 전문 암호 관리자와 동일한 보안 금고라고 가정하지 않는다. GM 값은 스크립트별 저장 데이터이며 사용자가 Storage 탭에서 조회·편집할 수 있다. [저장 API](https://www.tampermonkey.net/documentation.php?locale=en&q=GM_values), [Storage 탭](https://www.tampermonkey.net/faq.php?q=Q400)

## 암호문과 키 수명

GM 저장 키는 `enabled: boolean`과 `vault` 두 개다. `vault`는 아래 여섯 필드만 가진다. `salt`, `iv`, `ciphertext`는 Base64 문자열이며 버전과 KDF 파라미터는 공개 메타데이터다.

```json
{
  "v": 1,
  "kdf": "PBKDF2-SHA256",
  "iterations": 600000,
  "salt": "<16 random bytes, Base64>",
  "iv": "<12 random bytes, Base64>",
  "ciphertext": "<encrypted JSON and authentication tag, Base64>"
}
```

암호화할 평문은 `{email, password}`다. Web Crypto의 PBKDF2-HMAC-SHA256을 600,000회 적용해 AES-GCM 256비트 키를 유도한다. 저장마다 `crypto.getRandomValues`로 새 16바이트 salt와 12바이트 IV를 만든다. GCM 인증 태그는 128비트이며 AAD는 `chann.jumpcloud-login-assistant.vault.v1`로 고정한다. 유도한 CryptoKey는 `extractable: false`이고 저장하지 않는다.

PBKDF2는 브라우저 내장 API만으로 구현할 수 있어 선택했다. 600,000회는 OWASP의 PBKDF2-HMAC-SHA256 지침을 참고한 값이며, 이 구현의 별도 보안 감사나 인증을 의미하지 않는다. GCM은 암호문 변조를 검출하지만 정상적인 과거 암호문으로의 교체까지 구분하지는 못한다. [OWASP 지침](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [Web Crypto 키 유도](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey), [AES-GCM 파라미터](https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams)

1. 설정 창에서 이메일·비밀번호와 별도 잠금 암호·확인을 입력한다. 잠금 암호는 12~1024자, 비밀번호는 1~1024자, 이메일은 최대 254자다. 이메일 형식, 잠금 암호 확인, JumpCloud 비밀번호와의 차이를 검사한다.
2. 비동기 암호화 전에 입력란을 비운다. 암호화가 끝나면 창이 여전히 유효하고 허용된 경로·표시된 페이지인지 다시 확인한 뒤 암호문만 한 번 저장한다. 저장 실패 시 기존 기록을 삭제하지 않는다. 저장만으로 로그인을 시작하지 않는다.
3. 잠금 해제 시 저장 형식·버전·고정 KDF 작업량·Base64 길이를 먼저 검사한다. 지원하지 않는 형식이나 과도한 데이터로 키 유도를 시작하지 않는다. 복호화 후에도 JSON 구조와 이메일·비밀번호 범위를 검증한다.
4. 복호화가 끝나면 창의 유효성, 경로, 페이지 표시 상태와 저장 암호문 변경 여부를 다시 확인한다. 취소·화면 이탈·저장 정보 변경 중 완료된 결과는 로그인에 사용하지 않는다.
5. 검증된 ID/PW를 현재 페이지의 최대 2분 실행에만 전달한다. 키는 이후 보관하지 않는다. 잘못된 잠금 암호와 암호문 손상은 같은 정적 오류로 안내한다.
6. 제출 완료·취소·시간 초과·탭 숨김·경로 이탈 시 자동화를 종료하고 원문 참조를 해제한다. 아직 제출하지 않은 스크립트 입력 비밀번호가 그대로 남아 있으면 지운다. 수동 수정값과 제출된 값은 JumpCloud의 처리를 위해 유지한다.

잠금 암호 분실 시 복구 기능은 없다. 새 계정 정보와 잠금 암호를 등록하면 기존 암호문을 교체한다. 삭제 메뉴는 확인 후 자동 진행을 끄고 `GM_deleteValue('vault')`를 호출한다. 삭제 실패 시 이를 성공으로 안내하지 않는다. 다른 탭에서도 중지하거나 새로고침해야 변경이 확실히 반영된다.

## 확인한 JumpCloud 인터페이스

2026-09-14 공개 페이지의 값 없는 DOM 속성과 공개 로그인 번들 v0.232.0을 확인했다. 실제 계정 로그인과 자격증명 조회는 하지 않았다.

- 이메일 필드: `input[name="email"][type="email"][required]`, 폼 method POST. fieldset과 선택 사항인 Remember me 체크박스가 있다.
- 공식 버튼: `button[data-automation="loginButton"][type="submit"]`.
- UserPasswordEntry: `input[name="password"][type="password"][required]`. 빈 값이면 버튼이 disabled이며 같은 폼에 숨겨진 readonly 이메일 입력이 있다.
- Vue가 입력과 제출을 소유한다. native input value setter와 `input` / `change` 이벤트로 값을 전달한다. Vue 내부 상태를 직접 조회·수정하지 않는다.
- 비밀번호 입력의 Enter 처리가 native form submit 없이 실행될 수 있다. 수동 Login 클릭·Enter를 감지하면 자동화를 중지하되 제출에 필요한 비밀번호를 지우지 않는다.

페이지 구조는 변경될 수 있다. 알려진 폼을 찾지 못하면 임의의 로그인 버튼이나 입력란을 추측하지 않고 자동 제출하지 않는다. [User Portal 안내](https://jumpcloud.com/support/get-started-user-portal), [확인한 공개 번들](https://cdn03.jumpcloud.com/jumpcloud-login-ui/v0.232.0-16bc982eb6f40a8abc339a8f74780e8b6aaa99ab/jumpcloud-login.dcf650ec.js)

## 로그인 진행과 중단

1. 최상위 프레임, 정확한 HTTPS origin과 `/login` 또는 `/login/`를 확인한다. hash는 없음·`#`·`#/`, query는 없거나 `step=password` 하나만 허용한다. 넓은 메타데이터 match를 런타임 검사로 제한한다.
2. 암호문이 있으면 `enabled` 설정만으로 실행하지 않는다. 잠금 해제 메뉴에서만 현재 페이지의 저장 정보를 사용할 수 있다. 암호문이 없는 경우에만 외부 자동완성 모드를 허용한다.
3. 활성 탭이며 document에 포커스가 있는 동안 검사한다. MutationObserver와 500ms polling을 사용하고 최대 2분 뒤 종료한다. 비밀번호 제출 즉시 자동화를 종료하며 로그인 성공으로 추정하지 않는다.
4. 표시된 폼과 공식 버튼이 각각 하나여야 한다. POST, 본문 프레임 대상, 동일 출처 form action만 허용한다. 추가 입력, OTP, 새 비밀번호, 외부 action, base 태그, 별도 submit method 등 알려지지 않은 구조는 거부한다.
5. 저장 모드에서는 빈 필드를 채운다. 다른 이메일이나 비밀번호가 이미 입력되어 있으면 덮어쓰지 않는다. 비밀번호 입력 전에 readonly 이메일 하나가 저장 계정과 일치하는지 확인한다. 이메일은 앞뒤 공백과 대소문자를 정규화해 비교한다.
6. required 필드가 유효하고 버튼이 활성화된 상태가 1초 유지되면 제출을 준비한다. 저장 모드에서는 비밀번호가 비어 있어 버튼이 disabled여도 먼저 입력할 수 있다. 입력 이벤트의 재진입을 막고 안정화 시간을 다시 계산한다.
7. 동일 출처 Web Locks exclusive lock 안에서 경로·활성 상태·폼·MFA·알림·계정·설정을 다시 확인한다. 제출 시각을 기록한 다음 공식 버튼을 클릭한다. 잠금이나 기록 저장 실패 시 제출하지 않는다. [Web Locks 명세](https://www.w3.org/TR/web-locks/)
8. 이메일·비밀번호는 실행당 각각 한 번만 자동 제출한다. 같은 단계의 최근 10분 제출은 제한하며, 비밀번호 제출 기록은 두 단계 모두 제한한다. 이메일 제출 이후 비밀번호 단계는 진행할 수 있다. 10분 경과 자체로 재시도하지 않는다.
9. visible 오류·경고, MFA, 사용자 입력, Escape, 취소, 경로 이탈에서 중단한다. 숨겨진 탭은 저장 정보와 설정 창도 잠근다. 명시적 다시 시도는 기록을 초기화하며 저장 정보가 있으면 이후 다시 잠금을 해제해야 한다.

중복 방지 기록은 JumpCloud 출처의 전용 localStorage 키 `chann.jumpcloud-login-assistant.attempts.v1`에 `{email?: number, password?: number}` 시각만 저장한다. GM 캐시의 탭 간 지연에 의존하지 않도록 Web Locks 안에서 동기적으로 갱신한다. 페이지에서도 수정 가능한 비민감 데이터이며 인증 보안 경계는 아니다. 다른 JumpCloud 저장 키와 sessionStorage·쿠키는 조회하지 않는다.

## 검증과 남은 한계

Node.js test runner와 기존 jsdom을 사용하며 새 의존성은 없다. 가상 `.test` 계정만 사용한다. 저장 모드에서는 Node.js Web Crypto의 실제 PBKDF2와 AES-GCM으로 검증하고, 외부 자동완성 모드에서는 입력 원문 getter를 차단한다. 두 모드 모두 폼 직렬화·로그·쿠키·자체 네트워크·전체 페이지 HTML/텍스트 조회를 차단한다.

JumpCloud 85개, 기존 기능 포함 전체 183개 테스트가 통과했다. 독립 복호화, 평문 미저장, 무작위 salt/IV, 잘못된 암호와 변조 거부, 잘못된 계정 입력 방지, 취소 중 비동기 완료, 저장·삭제 실패, 숨김 시 재잠금, 수동 제출, 계정 변경, 중복 제출·탭 경쟁을 검증했다. `npm run check`와 `git diff --check`도 통과했다.

실제 Tampermonkey UI에서 등록·잠금 해제·자동 입력·MFA·포털 진입까지는 검증하지 않았다. jsdom 테스트는 실제 확장 프로그램의 실행 환경, 동기화, 브라우저 암호 관리자 간섭, 페이지의 최신 동작을 대신하지 않는다. 최초 설치 후 사용자가 자신의 환경에서 한 번 확인해야 한다. 스크립트는 잠금 암호 없는 무인 로그인이나 전문 암호 관리자 수준의 격리를 제공하지 않는다.
