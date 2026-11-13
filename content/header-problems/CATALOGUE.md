# Starter header-problem set — 50 problems

Five topics × 10 problems, easy → hard, in the style of 2110328 (`CP::` classes,
the student implements one member function in `student.h` and may edit the
functions marked "You MAY need to edit").

Each problem ships:

- `statement.pdf` — Thai, sections: คำอธิบาย / ข้อบังคับ / คำอธิบายฟังก์ชัน main /
  ตัวอย่าง / การทดสอบใน grader / ชุดข้อมูลทดสอบ (with the subtask percentages).
- `starter/` — `main.cpp` (simple, the one students get), `<ds>.h`, `student.h`
  (target function left empty), downloadable as a ZIP.
- `grader/` — the SECRET `main.cpp` (command-stream input, exercises the
  pre-existing functions too, instantiates more than one `T`) plus the same
  `<ds>.h`.
- `testcases/` — 10 cases, ordered so the stop-on-first-failure prefix score
  reproduces the statement's subtask percentages (case 1 = the smallest
  subtask).
- `solution/student.h` — reference, must judge **Accepted 100**.
- `solution/slow.h` — a deliberately naive version, must judge **TLE** on the
  large subtask (proves the cases separate the intended complexity).

Default limits: 1000 ms / 256 MB unless a row says otherwise.

Ids follow `hp_<topic><nn>_<name>`, collection `Header Problems — <Topic>`,
category `Data Structures`.

---

## A. `CP::pair<T1,T2>` — `pair.h`

Fields: `T1 first; T2 second;`. The class declares the target operators; the
student defines them in `student.h`.

| # | id | target | task | grader stresses |
|---|----|--------|------|-----------------|
| 1 | `hp_pair01_equal` | `bool operator==(const pair&) const` | both components equal | `pair<int,int>`, `pair<string,int>` |
| 2 | `hp_pair02_less` | `bool operator<(const pair&) const` | lexicographic | ties on `first` |
| 3 | `hp_pair03_gte` | `bool operator>=(const pair&) const` | lexicographic ≥ | equal pairs must be `true` |
| 4 | `hp_pair04_swapped` | `pair<T2,T1> swapped() const` | return the components exchanged | asymmetric types `pair<int,string>` |
| 5 | `hp_pair05_add` | `pair operator+(const pair&) const` | component-wise `+` | `string` concatenation as `T2` |
| 6 | `hp_pair06_maxpair` | `const pair& larger(const pair&) const` | the greater by (first, then second) | returns a reference, not a copy |
| 7 | `hp_pair07_normalize` | `void normalize()` (requires `T1==T2`) | ensure `first <= second` | idempotent: calling twice changes nothing |
| 8 | `hp_pair08_by_second` | `bool less_by_second(const pair&) const` | order by `second`, tie-break on `first` | used as a sort comparator in main |
| 9 | `hp_pair09_accumulate` | `pair& operator+=(const pair&)` | in-place add, returns `*this` | chained `a += b += c`; must agree with #5's `+` |
| 10 | `hp_pair10_ordering` | `<`, `<=`, `>`, `>=`, `==`, `!=` | a full, mutually consistent ordering | main checks all six agree on every pair of inputs |

## B. `CP::vector<T>` — `vector.h`

Fields: `T* mData; size_t mCap, mSize;` plus `expand`/`ensureCapacity`.

| # | id | target | task | subtasks / grader stresses |
|---|----|--------|------|---------------------------|
| 1 | `hp_vec01_fill` | `void fill(const T&)` | set every element | `n ≤ 10` → `n ≤ 10^6` |
| 2 | `hp_vec02_at` | `T& at(size_t)` / `const T& at(size_t) const` | bounds-checked, throws `std::out_of_range` | out-of-range reads interleaved with valid ones |
| 3 | `hp_vec03_pop_front` | `void pop_front()` | remove element 0 | repeated calls stay O(n) each; empty → no-op |
| 4 | `hp_vec04_erase` | `void erase(size_t pos)` | remove one element | erase at 0 / middle / last |
| 5 | `hp_vec05_insert` | `void insert(size_t pos, const T&)` | insert, growing capacity | insert at `mSize` (append) and at 0 |
| 6 | `hp_vec06_erase_many` | `void erase_many(const std::vector<size_t>&)` | erase at ascending positions, **O(n)** total | 50%: `n ≤ 10^6`, naive per-position erase must TLE |
| 7 | `hp_vec07_range_insert` | `void range_insert(size_t pos, const std::vector<T>&)` | insert a block, **O(n+m)** | one `ensureCapacity`, not m of them |
| 8 | `hp_vec08_block_swap` | `void block_swap(size_t i, size_t j, size_t len)` | swap two equal, non-overlapping blocks | adjacent blocks; `len` up to `n/2` |
| 9 | `hp_vec09_compress` | `void compress()` | drop consecutive duplicates, in place, **O(n)**, O(1) extra | all-equal and all-distinct inputs |
| 10 | `hp_vec10_rotate` | `void rotate(size_t k)` | rotate left by `k`, **O(n)** time, **O(1)** extra | `k > n`; three-reversal or cycle-walk expected, a temp buffer fails the memory subtask (32 MB) |

## C. `CP::stack<T>` — `stack.h`

Fields: `T* mData; size_t mCap, mSize; int aux;`.

| # | id | target | task | subtasks / grader stresses |
|---|----|--------|------|---------------------------|
| 1 | `hp_stk01_top` | `const T& top() const` | the topmost element | interleaved `push`/`pop`/`top` |
| 2 | `hp_stk02_second` | `const T& second() const` | the element below the top | `push`, `pop`, then `second` again |
| 3 | `hp_stk03_at` | `const T& at(size_t k) const` | k-th from the top (0 = top) | `k == mSize-1` (bottom) |
| 4 | `hp_stk04_pop_many` | `void pop(size_t k)` | pop `k` elements at once | `k == mSize`; `k` larger than the size |
| 5 | `hp_stk05_swap_top` | `void swap_top()` | swap the two topmost | repeated calls restore the original |
| 6 | `hp_stk06_deep_push` | `void deep_push(size_t k, const T&)` | insert below the top `k` elements | `k == 0` (plain push), `k == mSize` (bottom) |
| 7 | `hp_stk07_mitosis` | `void mitosis(size_t k)` | duplicate the top `k` in order | capacity growth; `k == mSize` |
| 8 | `hp_stk08_min` | `const T& min() const` | smallest element, **O(1)** | 50%: 10^6 ops, an O(n) scan must TLE; `pop` must restore the previous minimum |
| 9 | `hp_stk09_reverse` | `void reverse()` | reverse the whole stack, **O(1)** | up to 10^6 `reverse` calls interleaved with push/pop/top |
| 10 | `hp_stk10_rotate` | `void rotate(size_t k)` | rotate the top `k` by one | many rotations on a large `k`; the amortized bound is the point |

## D. `CP::queue<T>` — `queue.h`

Ring buffer: `T* mData; size_t mCap, mSize, mFront; int aux;`.

| # | id | target | task | subtasks / grader stresses |
|---|----|--------|------|---------------------------|
| 1 | `hp_que01_at` | `const T& at(size_t i) const` | i-th from the front | wrap-around (`mFront + i >= mCap`) |
| 2 | `hp_que02_back` | `const T& back() const` | the last element | after wrap-around and after `pop` |
| 3 | `hp_que03_push_front` | `void push_front(const T&)` | insert at the front | `mFront == 0` must wrap to `mCap-1` |
| 4 | `hp_que04_pop_back` | `void pop_back()` | remove the last element | down to empty, then push again |
| 5 | `hp_que05_m2b` | `void move_to_back(size_t i)` | move the i-th element to the back | `i == 0`, `i == mSize-1` |
| 6 | `hp_que06_m2f` | `void move_to_front(size_t i)` | move the i-th element to the front | same, plus repeated moves |
| 7 | `hp_que07_erase` | `void erase(size_t i)` | remove the i-th, **O(min(i, n-i))** | 50%: 10^6, always-shift-everything must TLE |
| 8 | `hp_que08_rotate` | `void rotate(size_t k)` | rotate by `k`, **O(1)** | `k > mSize`; element-by-element must TLE |
| 9 | `hp_que09_reverse` | `void reverse()` | reverse the queue, **O(1)** (lazy via `aux`) | ≤ 10^6 reverses; `push`/`pop`/`front`/`back` must all honour `aux` |
| 10 | `hp_que10_merge` | `void merge(queue& other)` | append `other`, emptying it, **O(n+m)** | `other` wrapped around; self-merge is not tested |

## E. `CP::priority_queue<T,Comp>` — `priority_queue.h`

Binary max-heap over an array: `T* mData; size_t mCap, mSize; Comp mLess;`.

| # | id | target | task | subtasks / grader stresses |
|---|----|--------|------|---------------------------|
| 1 | `hp_pq01_top` | `const T& top() const` | the maximum | `push`/`pop` interleaved |
| 2 | `hp_pq02_is_heap` | `bool is_heap() const` | validate the heap property | a deliberately corrupted array built by main |
| 3 | `hp_pq03_second` | `T second() const` | the second largest, **O(1)** | ties; `mSize == 2` |
| 4 | `hp_pq04_third` | `T third() const` | the third largest, **O(1)** | the candidate set is {children of the top two} |
| 5 | `hp_pq05_rank` | `size_t rank(size_t i) const` | how many elements are strictly greater than `mData[i]` | custom `Comp` (min-heap) |
| 6 | `hp_pq06_descendants` | `size_t descendants(size_t i) const` | number of descendants of index `i`, **O(log n)** | 50%: 10^6 queries, subtree walking must TLE |
| 7 | `hp_pq07_update` | `void update(size_t i, const T&)` | change a value and restore the heap, **O(log n)** | both directions (sift up and sift down) |
| 8 | `hp_pq08_erase` | `void erase(const T&)` | remove one occurrence, restore the heap | the value is absent; duplicates |
| 9 | `hp_pq09_merge` | `void merge(priority_queue& other)` | absorb another heap, **O(n+m)** | repeated `push` is O(m log n) and must TLE at 10^6 |
| 10 | `hp_pq10_kth` | `T kth(size_t k) const` | the k-th largest, **O(k log k)**, heap unchanged | `k ≤ 10^5` over a 10^6-element heap; sorting a copy must TLE |

---

## Verification contract (every problem, enforced by the harness)

1. `starter/` compiles with `solution/student.h` substituted and runs the
   statement's sample.
2. `grader/main.cpp` + `solution/student.h` → **Accepted** on all 10 cases.
3. `grader/main.cpp` + `solution/slow.h` → **TLE** on the last subtask (skipped
   only for problems with no complexity subtask, marked in `meta.json`).
4. `grader/` contains at least one `.cpp` and no file named `student.h`.
5. Testcase outputs are produced by the reference, never written by hand.
