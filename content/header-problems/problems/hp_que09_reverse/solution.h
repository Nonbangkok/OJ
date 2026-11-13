// Reference solution: reverse() is O(1) — it only flips the lazy `aux` flag,
// and every member that touches the ring honours it.
//
// With aux == 0 the logical front is mData[mFront] and the queue grows at
// (mFront + mSize) % mCap. With aux == 1 the ring is read back to front, so
// the logical front is the physical back and a push lands just BEFORE
// mFront. expand() keeps the physical order and leaves aux alone, so the
// logical order survives a resize either way.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "queue.h"
using namespace std;

template <typename T>
void CP::queue<T>::reverse()
{
  // Your code here
  aux = !aux;
}

template <typename T>
const T &CP::queue<T>::front() const
{
  // You MAY need to edit this function
  if (aux)
    return mData[(mFront + mSize - 1) % mCap];
  return mData[mFront];
}

template <typename T>
const T &CP::queue<T>::back() const
{
  // You MAY need to edit this function
  if (aux)
    return mData[mFront];
  return mData[(mFront + mSize - 1) % mCap];
}

template <typename T>
void CP::queue<T>::push(const T &element)
{
  // You MAY need to edit this function
  ensureCapacity(mSize + 1);
  if (aux)
  {
    // Reversed: the new element becomes the physical element before mFront.
    mFront = (mFront + mCap - 1) % mCap;
    mData[mFront] = element;
  }
  else
  {
    mData[(mFront + mSize) % mCap] = element;
  }
  mSize++;
}

template <typename T>
void CP::queue<T>::pop()
{
  // You MAY need to edit this function
  if (!aux)
  {
    mFront = (mFront + 1) % mCap;
  }
  mSize--;
}

#endif
