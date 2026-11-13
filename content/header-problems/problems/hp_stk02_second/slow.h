// Deliberately naive reference: it walks the array from the bottom to find
// the second-from-last slot in use instead of computing mSize - 2, so
// second() is Theta(n) per call.
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
const T &CP::stack<T>::second() const
{
  size_t below = 0;
  for (size_t i = 0; i + 2 < mSize; i++)
    below = i + 1;
  return mData[below];
}

#endif
