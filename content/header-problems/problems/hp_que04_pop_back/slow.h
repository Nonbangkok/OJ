// Deliberately naive reference: it walks the ring from mFront to find the
// slot the last element sits in, overwrites it with a default-constructed T
// and only then shortens the queue, so pop_back costs Theta(mSize) instead of
// O(1).
//
// It is CORRECT, only slower (and the clearing of the vacated slot is not
// observable). verify.py requires it to be Accepted on cases 1-7 and to time
// out on case 8, which is what proves the last subtask really separates
// "the queue is one shorter" from "walk to the end first".
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "queue.h"
using namespace std;

template <typename T>
void CP::queue<T>::pop_back()
{
  if (mSize == 0)
    return;
  size_t index = mFront;
  for (size_t step = 1; step < mSize; ++step)
  {
    index = index + 1;
    if (index == mCap)
      index = 0;
  }
  mData[index] = T();
  mSize--;
}

#endif
