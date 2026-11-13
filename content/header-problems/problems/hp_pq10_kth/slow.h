// Deliberately naive reference: correct, but it SORTS A COPY of the whole
// heap and indexes into it.
//
// Copying is O(n) and the heapsort is O(n log n) — per query, however small k
// is. That is the version the problem is built to reject: the large cases ask
// thousands of queries with k of a few hundred on heaps of several hundred
// thousand elements, where the intended solution never looks at more than a
// few thousand slots.
//
// It must produce exactly the reference's outputs and only be too slow:
// verify.py requires it to pass the first subtask and time out on the first
// case of the last one. (The sort is written out here because student.h may
// not include <algorithm>, and because it must compare with mLess like
// everything else.)
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "priority_queue.h"
using namespace std;

template <typename T, typename Comp>
T CP::priority_queue<T, Comp>::kth(size_t k) const
{
  if (k == 0 || k > mSize)
    throw std::out_of_range("index out of range");

  T *copy = new T[mSize];
  for (size_t i = 0; i < mSize; i++)
    copy[i] = mData[i];

  // Heapsort the copy into ascending order (by importance), using mLess.
  for (size_t start = mSize / 2; start > 0;)
  {
    start--;
    size_t node = start;
    while (true)
    {
      size_t child = 2 * node + 1;
      if (child >= mSize)
        break;
      if (child + 1 < mSize && mLess(copy[child], copy[child + 1]))
        child++;
      if (!mLess(copy[node], copy[child]))
        break;
      T hold = copy[node];
      copy[node] = copy[child];
      copy[child] = hold;
      node = child;
    }
  }
  for (size_t end = mSize; end > 1;)
  {
    end--;
    T hold = copy[0];
    copy[0] = copy[end];
    copy[end] = hold;
    size_t node = 0;
    while (true)
    {
      size_t child = 2 * node + 1;
      if (child >= end)
        break;
      if (child + 1 < end && mLess(copy[child], copy[child + 1]))
        child++;
      if (!mLess(copy[node], copy[child]))
        break;
      T swap_hold = copy[node];
      copy[node] = copy[child];
      copy[child] = swap_hold;
      node = child;
    }
  }

  T answer = copy[mSize - k];
  delete[] copy;
  return answer;
}

#endif
