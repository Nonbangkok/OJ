// Deliberately naive reference: it rebuilds the whole array into a freshly
// allocated one with the top two elements exchanged, so swap_top() is
// Theta(n) per call plus an allocation.
//
// It is CORRECT — the stack it leaves behind is exactly the reference's — and
// only wasteful. This problem has no complexity subtask (meta.json
// has_tle_subtask is false), so the harness does not require it to time out;
// it is kept so that every problem in the set carries the same eight files.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "stack.h"
using namespace std;

template <typename T>
void CP::stack<T>::swap_top()
{
  if (mSize < 2)
    return;
  T *arr = new T[mCap]();
  for (size_t i = 0; i < mSize; i++)
    arr[i] = mData[i];
  arr[mSize - 1] = mData[mSize - 2];
  arr[mSize - 2] = mData[mSize - 1];
  delete[] mData;
  mData = arr;
}

#endif
