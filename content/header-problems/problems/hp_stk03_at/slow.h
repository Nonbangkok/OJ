// Deliberately naive reference: instead of computing the mirrored index it
// counts down from the top one slot at a time, so at(k) is Theta(k) and
// reading the whole stack through at() is Theta(n^2).
//
// It is CORRECT — it returns exactly the same element — and only wasteful.
// This problem has no complexity subtask (meta.json has_tle_subtask is
// false), so the harness does not require it to time out; it is kept so that
// every problem in the set carries the same eight files.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "stack.h"
using namespace std;

template <typename T>
const T &CP::stack<T>::at(size_t k) const
{
  size_t index = mSize - 1;
  for (size_t step = 0; step < k; step++)
    index = index - 1;
  return mData[index];
}

#endif
