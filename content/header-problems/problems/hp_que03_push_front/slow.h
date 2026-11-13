// Deliberately naive reference: it keeps mFront where it is and shifts every
// existing element one slot to the right instead, so push_front costs
// Theta(mSize) rather than O(1).
//
// It is CORRECT, only slower. verify.py requires it to be Accepted on cases
// 1-7 and to time out on case 8, which is what proves the last subtask really
// separates "step mFront back one slot" from "shift the whole queue".
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "queue.h"
using namespace std;

template <typename T>
void CP::queue<T>::push_front(const T &element)
{
  ensureCapacity(mSize + 1);
  for (size_t step = mSize; step > 0; --step)
  {
    mData[(mFront + step) % mCap] = mData[(mFront + step - 1) % mCap];
  }
  mData[mFront] = element;
  mSize++;
}

#endif
