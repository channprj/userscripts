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
| GitHub Account Switcher | Organization/user별로 계정을 자동 전환하고 나머지 경로에서는 개인 계정을 사용합니다. | 0.1.0 | [Install](https://raw.githubusercontent.com/channprj/userscripts/main/github-account-switcher.user.js) |


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

GitHub의 **Account switcher** 메뉴를 이용해 접속한 organization/user에 맞는 계정으로 자동 전환합니다. 규칙에 없는 경로에서는 기본 개인 계정을 사용합니다.

1. 같은 브라우저의 GitHub에서 프로필 메뉴 → **Account switcher → Add account**로 사용할 계정들을 먼저 로그인합니다. 자세한 내용은 [GitHub 계정 전환 안내](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/switching-between-accounts)를 참고하세요.
2. 위 **Install** 링크로 스크립트를 설치하고 GitHub 페이지를 새로고침합니다.
3. 페이지의 **설정** 버튼 또는 Tampermonkey / Violentmonkey 메뉴의 **GitHub Account Switcher: 설정**을 엽니다.
4. **기본 개인 계정 username**을 입력하고, 전환 규칙을 한 줄에 하나씩 입력한 뒤 저장합니다.

다음은 형식 설명을 위한 가상 예시입니다. 실제 사용할 이름은 설정 화면에서 직접 입력하세요.

```text
sample-team = sample-work
sample-user = second-work
```

- 왼쪽은 URL의 organization/user 이름, 오른쪽은 전환할 계정의 **username**입니다. 표시 이름이나 URL 전체를 넣지 않습니다.
- `/sample-team` 및 그 아래 저장소·이슈·PR 경로, `/orgs/sample-team/...`, `/users/sample-user/...`를 인식합니다. 대소문자는 구분하지 않으며 `sample-team-extra`처럼 일부만 같은 이름은 매칭하지 않습니다.
- 설정의 초기값은 비어 있습니다. 입력한 계정명과 규칙은 `GM_setValue`를 통해 userscript 매니저 저장소에만 보관하며, 코드·설정 파일·Git 저장소에는 기록하지 않습니다. 스크립트 업데이트 후에도 설정이 유지됩니다. 매니저 자체의 백업·동기화 설정은 별도로 적용됩니다.
- **설정**에서 규칙 수정·삭제가 가능하며, 매니저 메뉴에서 **자동 전환 켜기/끄기**, **다시 시도**를 사용할 수 있습니다.
- URL 직접 접근과 GitHub 내부 페이지 이동을 감지합니다. 전환 중 메뉴가 잠깐 열릴 수 있으며, 원래 방문한 주소로 돌아가는 처리는 GitHub의 기본 전환 기능을 이용합니다.

동작 범위와 예외:

- `https://github.com/*`에 적용됩니다. GitHub.com의 Enterprise Managed User 계정도 사용할 수 있습니다. 별도 도메인의 Enterprise Server에는 적용되지 않습니다.
- 현재 보고 있는 활성 탭에서만 전환합니다. GitHub 로그인은 같은 브라우저의 탭들이 공유하므로 탭마다 계정을 독립적으로 유지하지는 않습니다. 다른 탭에서 계정이 바뀌었다면 현재 계정을 확인하고 필요할 때 페이지를 새로고침합니다.
- 로그인·로그아웃·SSO·2FA 등 인증 화면에서는 자동 전환을 보류합니다. 계정이 없거나 세션이 만료되면 직접 계정을 추가하거나 재인증한 후 **다시 시도**를 누르세요. 비밀번호와 인증 토큰은 수집하거나 저장하지 않습니다.
- 댓글이나 폼을 편집한 뒤 해당 입력란이 화면에 남아 있으면 전환을 보류합니다. 내용을 저장한 다음 페이지를 새로고침하면 다시 동작합니다.
- 전환 실패가 반복되면 자동 재시도를 멈춥니다. 상태를 확인한 뒤 **다시 시도**를 누르세요. GitHub 메뉴 구조가 바뀌어 계정을 찾지 못한 경우에도 알림을 표시하고 멈춥니다.

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

GitHub 스크립트 테스트는 실제 메뉴 구조를 반영한 가상 DOM과 가상 계정을 사용합니다. 경로별 전환, 개인 계정 복귀, 내부 이동, 로컬 설정, 인증 예외, 반복 전환 방지, 작성 중인 내용 보호를 확인합니다.

## License

[MIT](./LICENSE)
