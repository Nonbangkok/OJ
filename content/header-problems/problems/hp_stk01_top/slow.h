// Deliberately naive reference: it walks the array to find the last slot in
// use instead of computing mSize - 1, so top() is Theta(n) per call.
//
// It is CORRECT — it returns exactly the same element — and only wasteful.
// This problem has no complexity subtask (meta.json has_tle_subtask is
// false), so the harness does not require it to time out; it is kept so that
// every problem in the set carries the same eight files and so the naive
// reading of the task is on record.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "stack.h"
using namespace std;

template <typename T>
const T &CP::stack<T>::top() const
{
  size_t last = 0;
  for (size_t i = 0; i + 1 < mSize; i++)
    last = i + 1;
  return mData[last];
}

#endif
