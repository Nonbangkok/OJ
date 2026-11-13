// Deliberately naive reference: reverse() physically swaps the elements, so it
// is Theta(n) per call while every other member stays the textbook version.
//
// It is CORRECT — it must produce exactly the reference outputs — and only
// too slow. That is the point: verify.py requires it to Accept nothing but
// time out on the last case, which proves the large testcases really separate
// an O(1) reverse from an O(n) one.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "queue.h"
using namespace std;

template <typename T>
void CP::queue<T>::reverse()
{
  for (size_t i = 0; i + i + 1 < mSize; i++)
  {
    size_t a = (mFront + i) % mCap;
    size_t b = (mFront + mSize - 1 - i) % mCap;
    T hold = mData[a];
    mData[a] = mData[b];
    mData[b] = hold;
  }
}

template <typename T>
const T &CP::queue<T>::front() const
{
  return mData[mFront];
}

template <typename T>
const T &CP::queue<T>::back() const
{
  return mData[(mFront + mSize - 1) % mCap];
}

template <typename T>
void CP::queue<T>::push(const T &element)
{
  ensureCapacity(mSize + 1);
  mData[(mFront + mSize) % mCap] = element;
  mSize++;
}

template <typename T>
void CP::queue<T>::pop()
{
  mFront = (mFront + 1) % mCap;
  mSize--;
}

#endif
