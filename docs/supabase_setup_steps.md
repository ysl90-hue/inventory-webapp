# Supabase 재고관리 웹앱 단계별 구축

## 1단계: DB 생성 (Supabase)

1. Supabase 프로젝트 생성
2. SQL Editor 열기
3. `/supabase/schema.sql` 실행

생성되는 것:
- `parts` 테이블 (현재 재고)
- `stock_transactions` 테이블 (입출고 이력)
- `apply_stock_transaction` RPC 함수 (원자적 재고 반영)

## 2단계: 웹앱 실행 (Next.js)

1. `/web/.env.example` -> `/web/.env.local` 복사
2. Supabase `Project URL`, `anon key` 입력
3. `/web`에서 `npm install && npm run dev`

기본 제공 화면:
- 재고 목록 조회
- 검색
- 부족재고 필터
- 입고/출고 처리
- 최근 입출고 이력

## 3단계: CSV 초기 데이터 업로드

옵션 A (권장):
- Supabase Table Editor에서 `staging_parts_raw` 생성 후 CSV 업로드
- `/supabase/import_parts_from_csv.sql` 실행

옵션 B:
- CSV 헤더를 snake_case로 변경 후 바로 `parts`에 import

현재 CSV 헤더(공백 포함)도 지원하도록 SQL을 만들어둠.

## 다음 단계 (확장)

- 로그인 화면 추가 (Supabase Auth)
- 사용자별 권한 분리
- 품목 등록/수정/삭제 UI
- 거래 이력 필터(기간/품목번호)
- 대시보드 통계(부족재고 개수, 최근 출고량)

