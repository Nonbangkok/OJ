// Deliberately naive reference: it rebuilds the entire stack into a freshly
// allocated array on every call, so deep_push costs Theta(size) and one
// allocation even when k is 0.
//
// It is CORRECT — the stack it leaves behind is exactly the reference's — and
// only wasteful. This problem has no complexity subtask (meta.json
// has_tle_subtask is false): the intended bound is O(k), and the test data
// bounds the sum of k rather than separating O(k) from O(n), so the harness
// does not require this file to time out. It is kept so that every problem
// in the set carries the same eight files.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "stack.h"
using namespace std;

template <typename T>
void CP::stack<T>::deep_push(size_t k, const T &element)
{
  const T value = element;
  if (k > mSize)
    k = mSize;
  const size_t pos = mSize - k;
  T *arr = new T[mSize + 1]();
  for (size_t i = 0; i < pos; i++)
    arr[i] = mData[i];
  arr[pos] = value;
  for (size_t i = pos; i < mSize; i++)
    arr[i + 1] = mData[i];
  delete[] mData;
  mData = arr;
  mCap = mSize + 1;
  mSize++;
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
