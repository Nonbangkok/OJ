// Deliberately naive reference: it rotates the block for real on every call,
// so rotate(k) costs Theta(k) however many times the same k comes back.
//
// It is CORRECT — it produces exactly the reference's output — and only too
// slow. That is the point: verify.py requires this file to be Accepted on
// the small subtask and to time out on the first case of the large one,
// which proves the large cases really separate "rotate once per call" from
// "remember the rotation and pay for it once per block".
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "stack.h"
using namespace std;

template <typename T>
void CP::stack<T>::rotate(size_t k)
{
  const size_t span = (k > mSize) ? mSize : k;
  if (span <= 1)
    return;
  T hold = mData[mSize - 1];
  for (size_t i = mSize - 1; i > mSize - span; i--)
    mData[i] = mData[i - 1];
  mData[mSize - span] = hold;
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
