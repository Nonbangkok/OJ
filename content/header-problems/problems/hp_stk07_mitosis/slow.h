// Deliberately naive reference: it allocates a fresh array of exactly the
// right size on every call and copies the whole stack into it, so mitosis
// costs Theta(size) plus an allocation even for k = 1.
//
// It is CORRECT — the stack it leaves behind is exactly the reference's, and
// it dodges the dangling-reference trap by copying each element into a local
// before storing it — and only wasteful. This problem has no complexity
// subtask (meta.json has_tle_subtask is false), so the harness does not
// require this file to time out; it is kept so that every problem in the set
// carries the same eight files.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "stack.h"
using namespace std;

template <typename T>
void CP::stack<T>::mitosis(size_t k)
{
  if (k > mSize)
    k = mSize;
  if (k == 0)
    return;
  T *arr = new T[mSize + k]();
  for (size_t i = 0; i < mSize; i++)
    arr[i] = mData[i];
  for (size_t i = 0; i < k; i++)
  {
    const T value = mData[mSize - k + i];
    arr[mSize + i] = value;
  }
  delete[] mData;
  mData = arr;
  mCap = mSize + k;
  mSize = mSize + k;
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
