// Reference solution: the last element sits mSize - 1 slots to the right of
// mFront, counted around the ring, so the modulo is what makes it right once
// the data runs off the end of mData. mSize >= 1 is guaranteed by the
// statement, so mFront + mSize - 1 cannot underflow.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "queue.h"
using namespace std;

template <typename T>
const T &CP::queue<T>::back() const
{
  // Your code here
  return mData[(mFront + mSize - 1) % mCap];
}

#endif
