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
| Google Search Navigator | Google 검색 결과를 Vim 스타일 단축키로 탐색합니다.              | 0.11 | [Install](https://raw.githubusercontent.com/channprj/userscripts/main/google-search-navigator.user.js) |
| X Shortcut Extension    | X(구 Twitter)에서 한글 줄바꿈 개선과 Esc 단축키 동작을 추가합니다.   | 0.1  | [Install](https://raw.githubusercontent.com/channprj/userscripts/main/x-extension.user.js)             |
| iCloud Photos Copy Shortcut | iCloud Photos 상세 화면에서 `Cmd/Ctrl+C` 로 현재 사진을 클립보드에 복사합니다. | 0.1 | [Install](https://raw.githubusercontent.com/channprj/userscripts/main/icloud-photos-copy.user.js) |


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

Google 검색 결과를 키보드만으로 빠르게 탐색합니다.


| 키                  | 동작              |
| ------------------ | --------------- |
| `J` / `↓`          | 다음 결과로 이동       |
| `K` / `↑`          | 이전 결과로 이동       |
| `H` / `←`          | 이전 페이지          |
| `L` / `→`          | 다음 페이지          |
| `Enter`            | 현재 결과 열기        |
| `Cmd/Ctrl + Enter` | 현재 결과를 새 탭으로 열기 |
| `/`                | 검색창에 포커스        |
| `Esc`              | 검색창 포커스 해제      |


선택된 항목은 빨간색 좌측 보더로 강조 표시되며, 스크롤도 자동으로 따라옵니다.

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

iCloud Photos 웹에서 사진 상세를 본 뒤 우클릭 → **Copy Photos** 를 거치지 않고 `Cmd+C` / `Ctrl+C` 한 번으로 복사합니다.

- 상세 화면에 표시 중인 대형 이미지(뷰포트 중심에 가장 가까운 width ≥ 400px 이미지)를 자동으로 찾습니다.
- 캔버스로 PNG 인코딩 후 `navigator.clipboard.write(new ClipboardItem(...))` 로 클립보드에 씁니다.
- 텍스트가 선택되어 있거나 input/textarea/contentEditable 에 포커스가 있을 때는 가로채지 않고 기본 복사 동작을 그대로 둡니다.
- iCloud Photos 는 `applications/photos3/*` iframe 안에서 동작하므로 두 URL 모두 매치합니다.

- Match: `https://www.icloud.com/photos/*`, `https://www.icloud.com/applications/photos3/*`

---

## 개발

새 userscript를 추가할 때는 다음을 지켜주세요.

- 파일명은 `*.user.js`로 끝나야 매니저가 자동 설치 모드로 인식합니다.
- 상단에 `// ==UserScript== ... // ==/UserScript==` 메타데이터 블록을 반드시 포함합니다.
- 위 **Userscripts** 표와 상세 섹션에 항목을 추가합니다.

## License

[MIT](./LICENSE)