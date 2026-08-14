# 한판윷

방 코드와 닉네임만으로 입장해 여러 브라우저에서 함께 즐기는 서버 권위형 실시간 윷놀이입니다. 프런트엔드는 Vinext, 실시간 백엔드는 Fastify와 Socket.IO로 구성됩니다.

## 요구 사항과 설치

- Node.js 22.13 이상
- npm과 이 저장소에 커밋된 `package-lock.json`
- 브라우저 E2E에는 Chrome 또는 Edge
- Docker 실행에는 Docker Engine(선택 사항)

```bash
# CI, 컨테이너, 재현 가능한 검증: lockfile 그대로 깨끗하게 설치
npm ci

# 로컬에서 의존성을 추가·갱신하며 package-lock.json도 관리할 때
npm install

cp .env.example .env.local
```

두 설치 명령을 연달아 실행할 필요는 없습니다. 검증과 배포에는 `npm ci`를 사용하고, 로컬에서 의존성 구성을 변경할 때만 `npm install`을 사용합니다. Windows PowerShell에서는 `Copy-Item .env.example .env.local`을 사용합니다. `.env.local`에는 비밀값이 없지만 저장소에 커밋하지 않습니다.

## 로컬 개발

터미널 두 개에서 프런트엔드와 백엔드를 각각 실행합니다.

```bash
# 터미널 1: http://localhost:3000
npm run dev

# 터미널 2: http://localhost:3001
npm run dev:server
```

환경 변수의 의미는 다음과 같습니다.

| 이름 | 로컬 기본값 | 용도 |
| --- | --- | --- |
| `PORT` | `3001` | Socket.IO 백엔드가 수신할 포트 |
| `PUBLIC_ORIGIN` | `http://localhost:3000` | 백엔드가 허용할 정확한 브라우저 Origin |
| `NEXT_PUBLIC_GAME_SERVER_URL` | `http://localhost:3001` | 프런트엔드 번들에 포함할 공개 Socket.IO 주소 |

운영 환경에서는 HTTPS/WSS 조합을 사용합니다. 프런트엔드를 HTTPS로 제공하고 백엔드도 WSS를 사용할 수 있는 HTTPS 주소로 공개해야 합니다. `PUBLIC_ORIGIN`은 실제 프런트엔드 Origin(스킴, 호스트, 포트가 모두 동일하며 끝 슬래시 없음)과 정확히 맞추고, `NEXT_PUBLIC_GAME_SERVER_URL`은 실제 백엔드 HTTPS 주소로 프런트엔드를 빌드하기 전에 설정합니다.

## 테스트와 빌드

```bash
# 단위, 통합, UI 테스트
npm test

# 정적 검사
npm run lint

# 브라우저/서버와 Cloudflare Worker를 분리한 타입 검사
npm run typecheck

# 브라우저 전체 6개 시나리오
npm run test:e2e

# 데스크톱 3개 / 모바일 3개를 따로 실행
npm run test:e2e:desktop
npm run test:e2e:mobile

# Vinext 프런트엔드 빌드
npm run build

# Node 22에서 실행 가능한 백엔드 번들 생성
npm run build:server

# build/backend/index.js 운영 서버 시작
npm start

# 같은 운영 서버 명령의 명시적 별칭
npm run start:server

# /health와 실제 Socket.IO 2클라이언트 create/join smoke
npm run smoke:server
```

`npm run build:server`의 직접 출력은 `build/backend/index.js`이며 `npm start`와 `npm run start:server`는 그 파일을 직접 실행합니다. 이 경로는 Vinext 프런트엔드의 `dist/server` 출력과 분리되어 두 빌드가 서로를 덮어쓰지 않습니다. Docker 빌드만 backend artifact를 컨테이너 런타임의 `dist/server/index.js`로 복사합니다.

## Docker 백엔드

멀티 스테이지 이미지는 개발 의존성으로 백엔드를 빌드한 뒤 운영 의존성과 단일 서버 번들만 Node 22 런타임에 복사합니다. 런타임은 비루트 `node` 사용자로 동작하고 `/health`를 확인합니다.

```bash
docker build -t online-yutnori-server .
docker run --rm -p 3001:3001 \
  -e PORT=3001 \
  -e PUBLIC_ORIGIN=https://your-frontend.example \
  online-yutnori-server
```

PowerShell에서는 한 줄로 실행하거나 줄 끝의 `\` 대신 백틱을 사용합니다.

## 배포 구조

프런트엔드와 실시간 백엔드는 별도로 배포합니다.

1. Socket.IO WebSocket과 장시간 연결을 지원하는 컨테이너 호스트에 `Dockerfile`의 백엔드를 배포합니다.
2. 백엔드에 `PUBLIC_ORIGIN=https://실제-프런트엔드-호스트`를 설정합니다.
3. 프런트엔드 빌드 환경에 `NEXT_PUBLIC_GAME_SERVER_URL=https://실제-백엔드-호스트`를 설정한 뒤 Vinext 결과물을 배포합니다.
4. 백엔드 `/health`의 HTTP 200과 브라우저의 WSS 연결을 확인합니다.

운영 모드의 행동 제한 시간은 45초입니다. 재현 가능한 윷 결과를 위한 `YUT_RANDOM_SEED`와 1초 제한 시간은 정확히 `NODE_ENV=test`일 때만 적용되므로 운영 값을 바꾸지 않습니다.

## 게임 규칙

- 개인전은 2~4명이 참가하고 각자 말 4개를 조작합니다.
- 팀전은 8명이 2명씩 A/B/C/D 네 팀을 구성하는 2v2v2v2 방식입니다.
- 팀원 둘은 팀의 공용 말 4개를 함께 조작합니다.
- 팀전 턴 순서는 A1 → B1 → C1 → D1 → A2 → B2 → C2 → D2 입니다.
- 같은 편 말은 업기, 갈림길은 일반적인 윷놀이 규칙을 따릅니다.
- 도로 판에 들어선 말이 곧바로 빽도를 만나 출발점으로 되돌아가면, 한 바퀴를 돌아 참 앞에 선 것으로 칩니다. 그 자리에서 앞으로 나아가면 몇 칸이 나오든 그 말은 완주합니다. 반대로 빽도가 또 나오면 원래 있던 도 자리로 돌아갑니다.
- 윷과 모가 나오면 한 번 더 던지고, 상대 말을 잡아도 한 번 더 던집니다. 다만 **윷이나 모로 잡았을 때는 잡기 몫을 주지 않습니다**. 던지는 순간 이미 한 번 더 받았기 때문입니다. 표준 윷놀이는 두 조건을 서로 독립으로 보아 둘 다 주지만, 이 방은 겹쳐 주지 않는 변형을 씁니다.
- 행동 시간이 45초를 넘거나 현재 참가자의 연결이 끊기면 서버가 가능한 행동을 자동으로 진행합니다.
- 경기가 끝나면 결과 창에서 누구나 다시 하기를 부를 수 있습니다. 참가자와 팀을 그대로 둔 채 같은 방이 대기실로 돌아가고, 부른 사람만 준비 상태가 되므로 나머지는 각자 준비를 눌러 뜻을 밝힙니다. 대기실로 돌아가면 방 코드로 다시 들어올 수 있어 도중에 나간 사람도 합류할 수 있고, 경기 중 방장이 나갔다면 다시 하기를 부른 사람이 방장을 잇습니다.
- 대기실에서 말 색을 직접 고릅니다. 개인전은 각자, 팀전은 그 팀에 먼저 들어온 사람이 팀 색을 정합니다. 이미 다른 편이 고른 색은 잠기며 누가 쓰는지 알려 줍니다. 아무도 고르지 않은 색은 게임을 시작할 때 남은 것부터 채워집니다.
- 닉네임은 영문 또는 완성형 한글만 사용할 수 있고, 공백·숫자·기호·이모티콘 없이 2~12자여야 합니다.

## 3D 윷판과 윷가락

차례 안내 패널의 윷 결과는 three.js로 그립니다. 지름 한가운데보다 얕게 톱질한 윷가락 네 짝이 멍석에 누운 모습을 위에서 내려다보며, 던지면 굴러서 서버가 정한 면으로 내려앉습니다. 서버 `throwYut()`이 빽도로 세는 첫 번째 윷가락의 배에는 먹으로 표를 새겨, 왜 빽도인지 화면에서 확인할 수 있습니다.

- 나뭇결과 나이테는 캔버스에 직접 그리므로 내려받는 이미지나 모델 파일이 없습니다.
- 흩어지는 자리는 던지기 결과 id로 고정되어, 화면을 다시 그려도 윷가락이 움직이지 않습니다.
- 형상, 자세, 카메라 구도 계산은 `client/three/yutStick.ts`에 모아 두고 `tests/unit/yutStick.test.ts`에서 WebGL 없이 검증합니다. 재질과 조명은 `client/components/YutSticks.tsx`가 맡습니다.
- WebGL을 쓸 수 없거나 컨텍스트를 잃으면 CSS 윷가락으로 되돌아가고, `prefers-reduced-motion`에서는 굴리지 않고 결과 면만 보여 줍니다. 어느 경우에도 결과는 스크린 리더로 읽힙니다.

윷판과 말도 three.js로 그립니다. 판을 수직으로 내려다보는 정사 투영이라 화면 좌표가 판의 퍼센트 좌표와 정확히 같고, 그래서 말 버튼과 칸 라벨은 3D 위에 그대로 겹칩니다. 조작과 접근성은 언제나 DOM이 맡고 캔버스는 보이는 것만 그립니다.

- 말은 서버가 보내 준 `lastMove.path`를 따라 칸을 하나하나 밟아 갑니다. 밟아 가기 전체는 900ms를 넘지 않습니다.
- 상대 말을 잡으면 도착 칸에서 충격파가 퍼지고, 잡힌 말이 떠올라 작아지며 화면 아래쪽으로 밀려나 사라집니다.
- 편 색은 `client/sideColor.ts`가 단일 출처이며, `globals.css`와 어긋나면 테스트가 깨집니다.
- WebGL이 없거나 컨텍스트를 잃으면 지금까지의 2D 판이 그대로 나옵니다.

## 데이터와 보안 경계

모든 방, 재접속 세션, 게임 상태는 백엔드 프로세스 메모리에만 저장됩니다. 백엔드를 재시작하면 모든 방과 진행 중인 게임이 사라집니다. 여러 백엔드 인스턴스로 확장하려면 외부 상태 저장소와 Socket.IO 어댑터를 먼저 도입해야 합니다.

브라우저는 행동 의도만 전송하며 턴, 윷 결과, 이동 경로, 잡기, 승리 판정은 백엔드가 검증합니다. `PUBLIC_ORIGIN`은 CORS 편의 설정이 아니라 허용 Origin 경계이므로 와일드카드로 바꾸지 마십시오.
