# userscripts

[Tampermonkey](https://www.tampermonkey.net/) / [Violentmonkey](https://violentmonkey.github.io/) 등에서 사용하는 개인 userscript 모음입니다.

## 설치 방법

1. 브라우저에 userscript 매니저 확장 프로그램을 설치합니다.
  - [Tampermonkey](https://www.tampermonkey.net/) (Chrome / Edge / Firefox / Safari)
  - [Violentmonkey](https://violentmonkey.github.io/) (Chrome / Edge / Firefox)
2. 아래 표의 **Install** 링크를 클릭하면 매니저가 설치 화면을 자동으로 띄워줍니다.
3. 내용을 확인하고 설치를 완료합니다.

## Userscripts


| 이름                      | 설명                                             | 버전   | Install                                                                                                |
| ----------------------- | ---------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------ |
| Confluence Enhancer     | Confluence 우측 Rovo 버튼과 호버 시 뜨는 넛지를 숨깁니다. | 2    | [Install](https://raw.githubusercontent.com/channprj/userscripts/main/confluence-enhancer.user.js)     |
| Google Search Navigator | Google 검색 결과와 이미지·동영상·뉴스·쇼핑 탭을 Vim 스타일 단축키로 탐색합니다.   | 0.20 | [Install](https://raw.githubusercontent.com/channprj/userscripts/main/google-search-navigator.user.js) |
| X Shortcut Extension    | X(구 Twitter)에서 한글 줄바꿈 개선과 Esc 단축키 동작을 추가합니다.   | 0.1  | [Install](https://raw.githubusercontent.com/channprj/userscripts/main/x-extension.user.js)             |
| iCloud Photos Copy Shortcut | iCloud Photos 상세 화면 또는 그리드의 선택된 사진을 `Cmd/Ctrl+C` 로 클립보드에 복사합니다. | 0.2 | [Install](https://raw.githubusercontent.com/channprj/userscripts/main/icloud-photos-copy.user.js) |
| GitHub Account Switcher | Organization/user 또는 Enterprise 경로에 맞춰 계정을 자동 전환합니다. | 0.2.1 | [Install](https://raw.githubusercontent.com/channprj/userscripts/main/github-account-switcher.user.js) |
| JumpCloud Login Assistant | ID/PW를 Tampermonkey에 암호화해 저장하고 잠금 해제 후 자동 로그인합니다. | 0.2.0 | [Install](https://raw.githubusercontent.com/channprj/userscripts/main/jumpcloud-login-assistant.user.js) |


---

### Confluence Enhancer

`[confluence-enhancer.user.js](./confluence-enhancer.user.js)`

Atlassian Confluence 페이지에서 시야를 가리는 요소들을 정리합니다.

- 우측 액션바의 **Rovo 버튼** 숨김 (`hideRovoButton`)
- 호버 시 등장하는 **Rovo Proactive Nudge** 숨김 (`hideProactiveNudge`)
- 동적으로 다시 렌더링되는 경우에도 `MutationObserver`로 즉시 재차단

옵션은 스크립트 상단의 `CONFIG` 객체에서 조정할 수 있습니다.

- Match: `https://*.atlassian.net/wiki/*`, `https://*.atlassian.com/wiki/*`

---

### Google Search Navigator

`[google-search-navigator.user.js](./google-search-navigator.user.js)`

Google 검색 결과와 이미지·동영상·Short videos·뉴스·쇼핑 탭을 키보드만으로 빠르게 탐색합니다.


| 키                  | 동작              |
| ------------------ | --------------- |
| `J` / `↓`          | 다음 결과로 이동       |
| `K` / `↑`          | 이전 결과로 이동       |
| `H` / `←`          | 이전 페이지          |
| `L` / `→`          | 다음 페이지          |
| `Enter`            | 현재 결과 열기        |
| `Cmd/Ctrl + Enter` | 현재 결과를 새 탭으로 열기 |
| `/`                | 검색창에 포커스        |
| `?`                | 단축키 목록 열기/닫기     |
| `Esc`              | 검색창 포커스 해제      |


선택된 항목은 굵은 빨간색 외곽선과 halo로 카드 전체가 강조되며, 스크롤도 자동으로 따라옵니다.

이미지와 Short videos 탭에서는 `H` / `J` / `K` / `L` 또는 방향키로 실제 화면 배치에서 해당 방향의 같은 행·열에 가까운 카드를 우선해 이동합니다.
`Enter`를 처음 누르면 선택된 이미지를 크게 보고, 같은 이미지에서 한 번 더 누르면 원본 페이지로 이동합니다.
`Cmd/Ctrl + Enter`는 원본 페이지를 새 탭으로 엽니다.

동영상·뉴스·쇼핑 탭에서는 `J` / `K` 또는 위아래 방향키로 결과 카드를 순서대로 이동합니다. `Enter`는 선택된 결과를 열고, `Cmd/Ctrl + Enter`는 새 탭으로 엽니다.

검색 탭은 `g`를 누른 뒤 mnemonic 또는 숫자로 이동합니다.

| 키 | 검색 탭 |
| --- | --- |
| `g a` / `g 1` | AI Mode |
| `g h` / `g 2` | All |
| `g v` / `g 3` | Videos |
| `g i` / `g 4` | Images |
| `g s` / `g 5` | Short videos |
| `g n` / `g 6` | News |
| `g b` / `g 7` | Shopping |
| `g f` / `g 8` | Finance |

- Match: `http(s)://*.google.*/search*`

---

### X Shortcut Extension

`[x-extension.user.js](./x-extension.user.js)`

X(구 Twitter)의 한글 표시와 키보드 동작을 다듬습니다.

- 한국어(`lang=ko`) 트윗에 `word-break: keep-all`을 적용해 어색한 줄바꿈을 줄입니다.
- `Esc` 키로 열려 있는 팝업 메뉴 / 닫기 버튼 / 뒤로 가기 버튼을 순서대로 처리합니다.
- Match: `https://x.com/*`

---

### iCloud Photos Copy Shortcut

[`icloud-photos-copy.user.js`](./icloud-photos-copy.user.js)

iCloud Photos 웹에서 사진 상세나 그리드에서 우클릭 → **Copy Photos** 를 거치지 않고 `Cmd+C` / `Ctrl+C` 한 번으로 복사합니다.

- **상세 화면**: 뷰포트 중심에 가장 가까운 대형 이미지(width ≥ 400px, placeholder 제외)를 캔버스로 PNG 인코딩 후 클립보드에 씁니다.
- **그리드 뷰**: 선택된 `PhotoItemView` 의 내부 view 객체에서 medium JPEG (1536×2048, 우클릭 Copy Photos 와 동일 해상도) 의 downloadURL 을 읽어, `crossOrigin='anonymous'` 로 로드 → 캔버스 → PNG → 클립보드에 씁니다. 원본 HEIC 는 브라우저가 디코딩할 수 없으므로 medium JPEG 가 iCloud 의 사실상 "원본 복사" 해상도입니다.
- 텍스트가 선택되어 있거나 input/textarea/contentEditable 에 포커스가 있을 때는 가로채지 않고 기본 복사 동작을 그대로 둡니다.
- iCloud Photos 는 `applications/photos3/*` iframe 안에서 동작하므로 두 URL 모두 매치합니다.

- Match: `https://www.icloud.com/photos/*`, `https://www.icloud.com/applications/photos3/*`

---

### GitHub Account Switcher

[`github-account-switcher.user.js`](./github-account-switcher.user.js)

GitHub의 **Account switcher** 메뉴를 이용해 접속한 organization/user 또는 Enterprise 경로에 맞는 계정으로 자동 전환합니다. 규칙에 없는 경로에서는 기본 개인 계정을 사용하며, `/settings` 같은 GitHub 설정·시스템 페이지에서는 전환하지 않습니다.

1. 같은 브라우저의 GitHub에서 프로필 메뉴 → **Account switcher → Add account**로 사용할 계정들을 먼저 로그인합니다. 자세한 내용은 [GitHub 계정 전환 안내](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/switching-between-accounts)를 참고하세요.
2. 위 **Install** 링크로 스크립트를 설치하고 GitHub 페이지를 새로고침합니다.
3. 페이지의 **설정** 버튼 또는 Tampermonkey / Violentmonkey 메뉴의 **GitHub Account Switcher: 설정**을 엽니다.
4. **기본 개인 계정 username**을 입력하고, 전환 규칙을 한 줄에 하나씩 입력한 뒤 저장합니다.

다음은 형식 설명을 위한 가상 예시입니다. 실제 사용할 이름은 설정 화면에서 직접 입력하세요.

```text
sample-team = sample-work
sample-user = second-work
enterprises/* = sample-work
```

- 왼쪽은 URL의 organization/user 이름 또는 고정 규칙 `enterprises/*`, 오른쪽은 전환할 계정의 **username**입니다. 표시 이름이나 URL 전체를 넣지 않습니다.
- `/sample-team` 및 그 아래 저장소·이슈·PR 경로, `/orgs/sample-team/...`, `/users/sample-user/...`를 인식합니다. 대소문자는 구분하지 않으며 `sample-team-extra`처럼 일부만 같은 이름은 매칭하지 않습니다.
- `enterprises/*`는 `https://github.com/enterprises/`로 시작하는 모든 경로에 공통으로 적용합니다. 예를 들어 `/enterprises/sample-company`와 그 아래 설정·관리 페이지에서 지정한 계정으로 전환합니다. SSO·SAML·OIDC 인증 화면에서는 전환을 보류합니다.
- `enterprises/*` 규칙은 끝에 `/`가 없는 `/enterprises`나 `/enterprises-extra/...`에는 적용되지 않습니다. 기존에 `enterprises = username` 규칙도 입력했다면 `/enterprises/` 아래에서는 `enterprises/*` 규칙을 우선합니다.
- 설정의 초기값은 비어 있습니다. 입력한 계정명과 규칙은 `GM_setValue`를 통해 userscript 매니저 저장소에만 보관하며, 코드·설정 파일·Git 저장소에는 기록하지 않습니다. 스크립트 업데이트 후에도 설정이 유지됩니다. 매니저 자체의 백업·동기화 설정은 별도로 적용됩니다.
- URL 직접 접근과 GitHub 내부 페이지 이동을 감지합니다. 전환 중 메뉴가 잠깐 열릴 수 있으며, 원래 방문한 주소로 돌아가는 처리는 GitHub의 기본 전환 기능을 이용합니다.

기존 사용자는 스크립트를 **0.2.0 이상으로 업데이트**한 뒤, 아래 설정 메뉴에서 `enterprises/* = 사용할 username` 줄을 추가하고 저장하면 됩니다. 실제 계정명은 직접 입력하세요.

#### 설정 수정·초기화

설치 후 설정값을 바꾸려면 다음 순서로 진행합니다.

1. **GitHub 페이지를 연 상태에서** 브라우저의 **Tampermonkey / Violentmonkey 아이콘**을 클릭합니다.
2. **GitHub Account Switcher: 설정**을 선택합니다.
3. **기본 개인 계정 username**이나 **Organization / user / Enterprise 전환 규칙**을 수정합니다.
4. **저장**을 누릅니다.

처음 표시되는 페이지의 설정 안내를 닫았더라도, 매니저 메뉴에서 언제든 설정 화면을 다시 열 수 있습니다. 수정한 값도 userscript 매니저 저장소에만 보관되며 Git 저장소에는 기록되지 않습니다.

- **규칙 하나 삭제:** 해당 줄을 지우고 **저장**을 누릅니다.
- **전체 초기화:** 설정 화면의 **설정 삭제**를 누릅니다. 개인 계정과 모든 규칙이 삭제되며, 다시 설정할 때까지 자동 전환이 동작하지 않습니다.
- **자동 전환 일시 중지·재개:** 매니저 메뉴의 **GitHub Account Switcher: 자동 전환 켜기/끄기**를 선택합니다. 저장한 계정과 규칙은 유지됩니다.
- **전환 다시 시도:** 계정 추가나 재로그인 후 매니저 메뉴의 **GitHub Account Switcher: 다시 시도**를 선택합니다.

#### 동작 범위와 예외

- `https://github.com/*`에 적용됩니다. GitHub.com의 Enterprise Managed User 계정도 사용할 수 있습니다. 별도 도메인의 Enterprise Server에는 적용되지 않습니다.
- 현재 보고 있는 활성 탭에서만 전환합니다. GitHub 로그인은 같은 브라우저의 탭들이 공유하므로 탭마다 계정을 독립적으로 유지하지는 않습니다. 다른 탭에서 계정이 바뀌었다면 현재 계정을 확인하고 필요할 때 페이지를 새로고침합니다.
- `/settings`, `/notifications`, `/pulls`, `/issues`, `/codespaces`, `/search`, `/explore`, `/marketplace`처럼 GitHub이 예약한 설정·시스템 경로에서는 전환하지 않고 현재 계정을 유지합니다. 이 페이지들은 특정 organization/user가 아니라 로그인한 계정 자체를 다루기 때문입니다. 반면 `/sample-team/repo/settings`나 `/orgs/sample-team/settings`처럼 organization/user 이름으로 시작하는 설정 경로에는 규칙을 그대로 적용합니다.
- 로그인·로그아웃·SSO·2FA 등 인증 화면에서는 자동 전환을 보류합니다. 계정이 없거나 세션이 만료되면 직접 계정을 추가하거나 재인증한 후 **다시 시도**를 누르세요. 비밀번호와 인증 토큰은 수집하거나 저장하지 않습니다.
- 댓글이나 폼을 편집한 뒤 해당 입력란이 화면에 남아 있으면 전환을 보류합니다. 내용을 저장한 다음 페이지를 새로고침하면 다시 동작합니다.
- 전환 실패가 반복되면 자동 재시도를 멈춥니다. 상태를 확인한 뒤 **다시 시도**를 누르세요. GitHub 메뉴 구조가 바뀌어 계정을 찾지 못한 경우에도 알림을 표시하고 멈춥니다.

---

### JumpCloud Login Assistant

[`jumpcloud-login-assistant.user.js`](./jumpcloud-login-assistant.user.js) · [보안 설계](./docs/jumpcloud-login-design.md) · [개발·검증 기록](./docs/jumpcloud-login-plan.md)

`https://console.jumpcloud.com/login#/`의 **User Login**에서 저장한 이메일과 비밀번호를 입력하고 공식 로그인 버튼을 누릅니다. ID/PW는 별도 잠금 암호로 암호화해 Tampermonkey의 스크립트별 저장소에 보관합니다. 실제 ID/PW와 잠금 암호를 userscript 소스나 Git에 적지 않습니다.

**새 페이지에서는 잠금 암호를 다시 입력해야 합니다.** 잠금 해제 이후의 이메일·비밀번호 단계만 자동으로 진행하며, MFA는 직접 완료합니다. 암호화와 자동 입력 과정에서는 userscript 런타임이 ID/PW 원문을 일시적으로 다룹니다.

#### 로컬 보관과 최초 설정

1. Tampermonkey에서 [설치 링크](https://raw.githubusercontent.com/channprj/userscripts/main/jumpcloud-login-assistant.user.js)로 설치하거나 `0.2.0`으로 업데이트합니다. 로그인 화면을 새로고침합니다.
2. **로컬 전용으로 사용하려면 Tampermonkey의 동기화·클라우드 백업을 끄고 저장 데이터를 외부로 내보내지 마세요.** 이 스크립트는 확장 프로그램의 동기화 설정을 검사하거나 변경하지 않습니다. 동기화를 끄더라도 기존 원격 사본이 삭제되지는 않습니다. 브라우저 프로필·OS 백업도 사용자의 보관 정책을 따릅니다. [Tampermonkey 백업·내보내기 안내](https://www.tampermonkey.net/faq.php?q=Q106)
3. 정확한 JumpCloud 로그인 주소에서 Tampermonkey 메뉴의 **JumpCloud Login Assistant: 로그인 정보 설정**을 엽니다. JumpCloud 이메일·비밀번호와 **별도의 잠금 암호**를 입력하고 **암호화 저장**을 누릅니다. 잠금 암호는 JumpCloud 비밀번호와 달라야 하며, 최소 12자 이상의 길고 추측하기 어려운 문구를 사용하세요.
4. **JumpCloud Login Assistant: 잠금 해제 후 로그인**을 선택하고 잠금 암호를 입력합니다. 이 동작은 자동 진행도 활성화합니다. 활성 탭에서 이메일과 비밀번호가 입력되고 준비 상태가 1초 유지되면 **Continue / Login**을 한 번씩 누릅니다.
5. MFA를 직접 완료하고 실제 포털 진입을 확인합니다. **비밀번호 단계를 제출했습니다**라는 안내만으로 로그인 성공을 판단하지 않습니다.

ID/PW와 잠금 암호는 이 설정 창에서 직접 입력하세요. 소스, 채팅, `.env`, 저장소 파일, Tampermonkey Storage 탭에 평문으로 입력할 필요가 없습니다. **한 계정만 저장**하며, 설정을 다시 저장하면 기존 암호문을 교체합니다. 잠금 암호를 잊으면 복구할 수 없으므로 로그인 정보를 새로 등록해야 합니다.

JumpCloud의 **Remember me**나 브라우저 자동완성이 다른 계정을 입력했다면 자동화를 중단합니다. 비밀번호 단계에서도 페이지의 계정이 저장한 이메일과 일치해야 입력합니다. 계정을 바꾸거나 잘못 채워진 필드를 지운 뒤 다시 잠금을 해제하세요.

#### 동작 제어

| 매니저 메뉴 | 동작 |
| --- | --- |
| **로그인 정보 설정** | 계정과 별도 잠금 암호를 입력해 암호화 저장합니다. 기존 저장 정보가 있으면 교체합니다. |
| **잠금 해제 후 로그인** | 잠금 암호로 복호화하고 현재 페이지에서 한 번의 로그인 실행을 시작합니다. |
| **저장 정보 삭제** | 확인 후 암호문을 삭제하고 자동 진행을 끕니다. 별도 백업·원격 사본에는 영향을 주지 않습니다. |
| **자동 진행 켜기/끄기** | 사용 여부를 저장합니다. 켜더라도 저장 정보의 잠금은 해제하지 않습니다. |
| **현재 페이지 중지** | 현재 실행을 중지하고 이 페이지의 저장 정보를 잠급니다. |
| **다시 시도** | 자동 진행이 켜져 있을 때 제출 제한 기록을 초기화합니다. 저장 정보가 있으면 다시 잠금을 해제해야 합니다. |
| **상태 안내** | 닫은 안내를 다시 표시합니다. ID/PW는 표시하지 않습니다. |

페이지 안내의 **중지** 또는 `Esc`도 현재 실행을 중단합니다. **닫기**는 안내만 숨깁니다. 직접 타이핑·붙여넣기·수동 제출을 감지하면 자동화를 중지합니다. 다른 로그인 탭이 열려 있다면 그 탭에서도 중지하거나 새로고침해 설정 변경·삭제를 반영하세요.

- 한 실행은 최대 2분 동안 기다리며 이메일·비밀번호를 각각 한 번만 자동 제출합니다.
- 탭이 숨겨지거나 페이지를 벗어나면 잠급니다. 중지할 때 아직 제출하지 않은, 스크립트가 채운 비밀번호는 그대로 남아 있는 경우 지웁니다. 사용자가 바꾼 값이나 이미 제출한 값은 지우지 않습니다.
- 최근 10분 이내의 자동 제출 기록으로 재로드·다른 탭의 중복 제출을 제한합니다. 이메일 제출 후 비밀번호 단계는 진행할 수 있습니다. 10분이 지났다고 자동 재시도하지는 않습니다.
- 현재 활성 탭에서만 진행합니다. 오류/경고, 추가 인증, 지원하지 않는 폼이나 경로에서는 진행하지 않습니다.
- 대상은 정확한 `https://console.jumpcloud.com/login` 또는 `/login/`이며, 빈 hash 또는 `#/`, query 없음 또는 `step=password`만 허용합니다. Admin Login, 다른 데이터 센터 도메인, 외부 IdP, SSO/OAuth 특수 경로, 가입·재설정 흐름에는 적용하지 않습니다.
- Web Locks 또는 로컬 저장소를 사용할 수 없으면 제출하지 않습니다. 브라우저 보안 설정을 낮추지 말고 수동으로 로그인하세요.

#### 보안 경계와 저장 데이터

Tampermonkey의 `GM_setValue` / `GM_getValue`는 GitHub Account Switcher에서도 사용하는 **스크립트별 저장 기능**입니다. 비밀번호 전용 금고로 간주하지 않고, 저장 전에 ID/PW를 함께 **AES-GCM-256**으로 암호화합니다. 잠금 암호에서 PBKDF2-HMAC-SHA256 600,000회로 키를 유도하며 매 저장마다 새 salt와 IV를 생성합니다. 잠금 암호와 복호화 키는 저장하지 않습니다. [Tampermonkey 저장 API](https://www.tampermonkey.net/documentation.php?locale=en&q=GM_values)

| 저장 위치 | 보관 내용과 담당 |
| --- | --- |
| Tampermonkey 저장소 | `enabled` boolean과 `vault` 암호문·버전·KDF 정보·salt·IV. 이메일·비밀번호·잠금 암호의 평문과 키는 저장하지 않습니다. |
| 현재 페이지의 메모리·입력 필드 | 설정·복호화·로그인 동안 필요한 원문. 스크립트는 완료·중지 시 참조를 해제하지만 JavaScript 메모리의 완전한 소거를 보장하지 않습니다. |
| JumpCloud 출처의 전용 localStorage 키 | `chann.jumpcloud-login-assistant.attempts.v1`에 이메일/비밀번호 단계의 제출 시각만 저장합니다. 계정이나 입력값은 없습니다. |

스크립트 자체의 네트워크 요청, 외부 라이브러리, 자격증명 로그·클립보드·파일 출력은 없습니다. 쿠키, JumpCloud 자체 저장 키, Vue 내부 상태에도 접근하지 않습니다. 인증 요청은 기존 버튼을 통해 JumpCloud 페이지가 처리합니다. 전용 제출 기록은 Web Locks 안에서 갱신하는 비민감 중복 방지 데이터이며 페이지에서도 변경할 수 있습니다. 삭제하려면 개발자 도구의 저장소 화면에서 **해당 키만** 지우면 됩니다.

**암호화는 저장된 데이터를 보호하며, 실행 중인 페이지·확장 프로그램·변조된 userscript로부터 원문을 격리하지는 않습니다.** 설정 창의 closed Shadow DOM도 보안 경계가 아닙니다. 잠금 암호 입력과 복호화 시점에는 신뢰할 수 있는 페이지와 브라우저 환경이 필요합니다. 암호문이 복사되면 잠금 암호에 대한 오프라인 추측이 가능하므로 긴 암호를 사용하세요. OS Keychain이나 전문 암호 관리자의 보안 수준을 보장하는 기능은 아닙니다.

저장 정보를 등록하지 않은 경우에는 기존 외부 암호 관리자 자동완성 모드도 사용할 수 있습니다. **자동 진행 켜기/끄기**로 활성화하며, 이 모드에서는 스크립트가 입력 원문을 읽지 않고 준비 상태만 확인합니다. 암호문이 등록되어 있으면 잠금 해제 없이 이 모드로 우회하지 않습니다.

#### 검증 범위

공개 로그인 화면의 DOM 속성과 공개 로그인 번들의 비밀번호 컴포넌트를 확인했습니다. JumpCloud 테스트 85개에서 실제 Web Crypto를 사용한 암호화·복호화, 변조 거부, 계정 일치, 취소·재잠금, 수동 제출, 탭 경쟁, 저장 실패와 반복 제출 제한을 검증했습니다. 기존 테스트를 포함한 전체 183개와 문법 검사가 통과했습니다. **실제 Tampermonkey에서 계정 등록 → 잠금 해제 → MFA → 포털 진입까지의 통합 검증은 수행하지 않았습니다.** 설치 후 위 절차로 확인하세요.

---

## 개발

새 userscript를 추가할 때는 다음을 지켜주세요.

- 파일명은 `*.user.js`로 끝나야 매니저가 자동 설치 모드로 인식합니다.
- 상단에 `// ==UserScript== ... // ==/UserScript==` 메타데이터 블록을 반드시 포함합니다.
- 위 **Userscripts** 표와 상세 섹션에 항목을 추가합니다.

테스트는 Node.js 22.22.2 이상(22.x), 24.15.0 이상(24.x), 또는 26 이상에서 실행합니다. 설치해서 사용하는 userscript 자체에는 Node.js가 필요하지 않습니다.

```sh
npm ci
npm test
npm run check
```

GitHub 스크립트 테스트는 실제 메뉴 구조를 반영한 가상 DOM과 가상 계정을 사용합니다. Organization/user 및 Enterprise 경로별 전환, 개인 계정 복귀, 설정·시스템 경로 제외, 내부 이동, 로컬 설정, 인증 예외, 반복 전환 방지, 작성 중인 내용 보호를 확인합니다.

JumpCloud 스크립트 테스트는 가상 DOM과 가상 계정을 사용합니다. 저장 모드는 Node.js Web Crypto의 실제 PBKDF2/AES-GCM으로 검증하고, 외부 자동완성 모드는 입력 원문 접근을 차단해 검증합니다. 두 모드 모두 폼 직렬화, 로그, 쿠키, 네트워크, 페이지 전체 텍스트/HTML 조회를 차단합니다. Web Locks, 매니저 설정, 전용 제출 기록은 테스트 경계에서 재현하며 실제 브라우저 암호 저장소는 읽지 않습니다.

## License

[MIT](./LICENSE)
