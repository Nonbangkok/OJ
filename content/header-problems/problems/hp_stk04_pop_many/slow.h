// Deliberately naive reference: it calls pop() k times instead of adjusting
// mSize once. The guard `mSize > 0` keeps it CORRECT even when k is larger
// than the stack, it just does k steps of work instead of one.
//
// Removing k elements one at a time is still O(k) and k can never usefully
// exceed the stack's height, so this problem has no complexity subtask
// (meta.json has_tle_subtask is false) and the harness does not require this
// file to time out. It is kept so that every problem in the set carries the
// same eight files, and because the loop is the shape most students reach
// for first.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "stack.h"
using namespace std;

template <typename T>
void CP::stack<T>::pop(size_t k)
{
  for (size_t i = 0; i < k; i++)
  {
    if (mSize == 0)
      break;
    pop();
  }
}

#endif
