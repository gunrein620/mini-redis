# Mini Redis

## 프로젝트 개요

본 프로젝트는 해시 테이블(Hash Table) 기반의 Mini Redis를 구현하는 것을 목표로 한다.  
Mini Redis는 key-value 형태의 데이터를 메모리에 저장하고 빠르게 조회할 수 있는 저장소이며, 외부 애플리케이션에서도 사용할 수 있도록 HTTP API 기반 구조로 설계하였다.

본 프로젝트를 통해 다음을 구현하고 검증한다.

- 해시 테이블 기반 key-value 저장소 구현
- HTTP API를 통한 외부 접근
- TTL(Time To Live) 기반 데이터 만료 처리
- 단위 테스트 및 기능 테스트를 통한 검증
- 캐시 사용 여부에 따른 성능 차이 확인

---

# 전체 아키텍처

Mini Redis는 다음과 같은 구조로 설계하였다.


Client
↓
HTTP API Server
↓
Mini Redis Engine
↓
Custom HashTable


## 각 레이어 역할

| Layer | 역할 |
|------|------|
| Client | Mini Redis API를 호출하는 외부 사용자 |
| HTTP API Server | HTTP 요청 처리 및 Redis Engine 호출 |
| Mini Redis Engine | Redis 기능 로직 처리 |
| Custom HashTable | 실제 key-value 데이터 저장 |

이 구조를 통해 API 처리 로직과 저장소 로직을 분리하고,  
모든 데이터 조작이 Mini Redis Engine을 통해 이루어지도록 설계하였다.

---

# Hash Table 설계 원리

Mini Redis의 핵심 저장소는 Hash Table이다.

해시 테이블은 key를 이용해 데이터를 빠르게 저장하고 조회하기 위한 자료구조이며 다음 세 가지 요소로 구성된다.

## 1. 배열 기반 저장 구조

해시 테이블은 내부적으로 배열(Array)을 사용하여 데이터를 저장한다.

예를 들어 크기가 16인 배열을 생성하면 다음과 같은 구조가 된다.


index
0
1
2
3
...
15


각 배열 칸은 bucket이라고 하며, 이 bucket에 key-value 데이터를 저장한다.

## 2. 해시 함수 (Hash Function)

문자열 key를 배열 인덱스로 변환하기 위해 해시 함수를 사용한다.


key → hash function → 숫자 → 배열 인덱스


예


"user:1" → hash 값 계산 → 123456
123456 % 16 = 8


따라서 "user:1"은 배열의 8번 bucket에 저장된다.

이 과정 덕분에 특정 key의 저장 위치를 빠르게 계산할 수 있다.

## 3. 충돌 처리 (Collision Handling)

서로 다른 key가 동일한 인덱스로 계산되는 경우가 발생할 수 있다.  
이를 충돌(Collision)이라고 한다.

예


hash("apple") = 3
hash("banana") = 3


본 프로젝트에서는 충돌을 해결하기 위해 Separate Chaining 방식을 사용하였다.


bucket[3] = [
("apple", value1),
("banana", value2)
]


조회 시 bucket 내부에서 key를 비교하여 정확한 값을 찾는다.

---

# 해시 테이블 구현 과정

Mini Redis의 해시 테이블은 다음 단계로 구현하였다.

1. bucket 배열 생성  
2. 문자열 key를 숫자로 변환하는 hash 함수 구현  
3. key → hash → bucket index 계산  
4. bucket에 key-value 저장  
5. 충돌 시 bucket 내부 리스트에 추가  
6. 데이터 증가 시 resize 및 rehash 수행  

이를 통해 평균적으로 O(1) 시간 복잡도로 저장 및 조회가 가능하다.

---

# 주요 함수 동작 방식

## set(key, value)

key-value 데이터를 저장한다.

### 동작 과정

1. key의 hash 값을 계산하여 bucket index를 찾는다  
2. 해당 bucket 확인  
3. 동일한 key가 존재하면 value 업데이트  
4. 존재하지 않으면 새로운 key-value 추가  

시간 복잡도


평균 O(1)


---

## get(key)

key를 이용해 데이터를 조회한다.

### 동작 과정

1. key hash 계산  
2. bucket index 찾기  
3. bucket 내부에서 key 비교  
4. 동일 key 발견 시 value 반환  
5. 존재하지 않으면 undefined 반환  

시간 복잡도


평균 O(1)


---

## delete(key)

특정 key를 삭제한다.

### 동작 과정

1. key hash 계산  
2. bucket index 찾기  
3. bucket 내부에서 key 탐색  
4. key-value 삭제  

시간 복잡도


평균 O(1)


---

# 동시성 문제를 줄이기 위한 구조

Mini Redis는 여러 요청이 동시에 들어올 수 있기 때문에 같은 key에 대해  
동시에 저장, 삭제, 조회가 발생하면 데이터 상태가 꼬일 수 있다.

이를 단순하게 관리하기 위해 단일 서버 + 단일 프로세스 + 단일 메모리 저장소 구조를 선택하였다.


Client
↓
API Server
↓
Mini Redis Engine
↓
In-Memory HashTable


모든 데이터 접근은 Mini Redis Engine을 통해서만 수행되도록 하였다.

이 방식의 장점

- 저장소가 하나이기 때문에 상태 관리가 단순하다
- 데이터 변경 경로가 명확하다
- 서버 간 동기화나 분산 락이 필요 없다

---

# TTL (Time To Live) 처리 방식

Mini Redis는 key-value 데이터를 저장할 때 TTL(Time To Live)을 설정할 수 있다.

예


SET session:1 token TTL=60


위 예시는 session:1 데이터가 60초 동안만 유효함을 의미한다.

## TTL 저장 방식

TTL이 설정된 데이터는 value와 함께 만료 시각(expireAt)을 저장한다.


{
key: "session:1",
value: "token",
expireAt: 1710000000
}


expireAt은 현재 시간 + TTL로 계산된 절대 시간이다.

---

## 만료 데이터 처리 방식

본 프로젝트에서는 Lazy Expiration 방식을 사용한다.

### 동작 과정


GET key
→ key 조회
→ expireAt 확인
→ 현재 시간 > expireAt
→ 데이터 삭제
→ cache miss 반환


즉 조회 시점에 만료 여부를 확인하고 삭제한다.

---

# HTTP API 설계

Mini Redis는 외부에서도 쉽게 사용할 수 있도록 HTTP API 형태로 제공한다.

## 데이터 저장


POST /kv


## 데이터 조회


GET /kv/:key


## 데이터 삭제


DELETE /kv/:key


## TTL 설정


POST /kv/:key/expire


---

# 캐시 데모 API

Mini Redis가 실제 캐시처럼 동작하는지 확인하기 위해  
외부 API 응답을 저장하는 데모 API를 제공한다.

## 캐시 사용


GET /demo/user/:id


### 동작

1. Mini Redis에서 데이터 조회  
2. 없으면 외부 API 호출  
3. 응답을 Redis에 저장  
4. 다음 요청부터 캐시 사용  

---

## 캐시 미사용


GET /demo-no-cache/user/:id


매번 외부 API를 호출한다.

---

# 테스트 전략

Mini Redis의 기능을 검증하기 위해 다음 테스트를 수행한다.

## 단위 테스트

- HashTable 저장 / 조회 / 삭제  
- collision 처리  
- overwrite 동작  
- TTL 만료 처리  

## 기능 테스트

- API 저장 / 조회 / 삭제  
- TTL 적용 여부  
- 캐시 hit / miss 확인  

---

# Edge Case 고려

다음과 같은 경계 상황을 고려하였다.

- 존재하지 않는 key 조회  
- 존재하지 않는 key 삭제  
- 동일 key overwrite  
- TTL이 0 또는 음수인 경우  
- TTL 만료 직후 조회  
- Hash collision 상황  
- resize 이후 데이터 유지  

이를 통해 Mini Redis가 다양한 상황에서도 안정적으로 동작하도록 하였다.

---

# 성능 비교

캐시 사용 여부에 따른 성능 차이를 비교한다.

## 캐시 미사용


GET /demo-no-cache/user/:id


매번 외부 API 호출

## 캐시 사용


GET /demo/user/:id


첫 요청만 외부 API 호출  
이후 요청은 Mini Redis에서 응답

이를 통해 캐시 사용 시 응답 속도가 개선되는 것을 확인할 수 있다.

---

# 정리

Mini Redis는 다음 기능을 중심으로 구현하였다.

- Hash Table 기반 key-value 저장소
- HTTP API 기반 외부 접근
- TTL 기반 데이터 만료 처리
- 단위 테스트 및 기능 테스트
- 캐시 활용 및 성능 비교

이를 통해 Redis의 핵심 개념을 단순화하여 구현하였다.

# 시연 시나리오

시연 목표

1. key-value 저장소 동작
2. cache hit / miss
3. TTL 만료
4. 캐시 사용 시 성능 개선



1. 첫 요청
   → Redis에 없음
   → 외부 API 호출
   → Redis 저장
   → 응답

2. 두 번째 요청
   → Redis에 있음
   → 바로 응답

3. TTL 만료 후 요청
   → 만료 확인
   → 삭제
   → 다시 외부 API 호출

4. no-cache와 속도 비교



# Redis 서버를 따로 둘 경우

원래 하려던 저장소 구현 문제에 더해서 통신, 장애, 테스트, 배포, 디버깅 문제가 추가된다.(발표할 때 추가로 설명해야함 - 왜 분리했는지, 서버 간 통신 방식, 장애 시 처리 방식, 응답 스키마, 동기화 문제)


