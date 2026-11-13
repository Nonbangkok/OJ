// Deliberately naive reference: min() scans the whole array on every call,
// and push/pop keep no bookkeeping at all.
//
// It is CORRECT — it returns exactly the same minimum, ties included, since
// the VALUE is what the grader prints — and only too slow. That is the
// point: verify.py requires this file to be Accepted on the small subtask
// and to time out on the first case of the large one, which proves the large
// cases really separate an O(1) min() from an O(n) one.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "stack.h"
using namespace std;

template <typename T>
const T &CP::stack<T>::min() const
{
  size_t best = 0;
  for (size_t i = 1; i < mSize; i++)
    if (mData[i] < mData[best])
      best = i;
  return mData[best];
}

template <typename T>
const T &CP::stack<T>::top() const
{
  return mData[mSize - 1];
}

template <typename T>
void CP::stack<T>::push(const T &element)
{
  ensureCapacity(mSize + 1);
  mData[mSize] = element;
  mSize++;
}

template <typename T>
void CP::stack<T>::pop()
{
  if (mSize > 0)
    mSize--;
}

#endif
