# CLAUDE.md

## Project Goal

이 저장소는 `Bus Fever! Car Jam Escape`의 코어인 차량 탭, 슬롯 관리, 컬러 매칭 흐름을 HTML5에서 빠르게 검증하고, 이후 상용 레벨 엔진/제너레이터/솔버 구조로 확장하기 위한 패키지다.

## Core Product Rules

- 차량을 탭하면 조건에 맞는 승객이 슬롯으로 이동한다.
- 슬롯은 최대 7칸이며, 같은 색 승객 3명이 모이면 버스가 출발한다.
- `Mystery`, `Frozen`, `Tunnel` 기믹은 데이터 기반으로 처리한다.
- 접근성 옵션으로 색약 모드를 기본 고려한다.
