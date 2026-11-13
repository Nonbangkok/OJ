// Deliberately naive reference: reverse() exchanges the elements for real,
// so it is Theta(n) per call, while push, pop and top stay the textbook
// versions that keep the stack at [0, mSize).
//
// It is CORRECT — it produces exactly the reference's output — and only too
// slow. That is the point: verify.py requires this file to be Accepted on
// the small subtask and to time out on the first case of the large one,
// which proves the large cases really separate an O(1) reverse from an O(n)
// one.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "stack.h"
using namespace std;

template <typename T>
void CP::stack<T>::reverse()
{
  for (size_t i = 0; i + i + 1 < mSize; i++)
  {
    T hold = mData[i];
    mData[i] = mData[mSize - 1 - i];
    mData[mSize - 1 - i] = hold;
  }
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
