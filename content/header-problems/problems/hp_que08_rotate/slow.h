// Deliberately naive reference: it does reduce k modulo mSize — so a `k` of
// two billion costs nothing extra — but then always turns the ring FORWARD,
// one position at a time. Perfectly correct, and fine when the remainder is
// small; Theta(mSize) whenever the remainder is close to mSize, which is what
// most of the large cases ask for.
//
// verify.py requires this file to be Accepted on cases 1-5 and to time out on
// case 6, which is what proves the large testcases really separate
// O(min(r, n - r)) from "always rotate forward".
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "queue.h"
using namespace std;

template <typename T>
void CP::queue<T>::rotate(size_t k)
{
  if (mSize == 0)
    return;

  size_t steps = k % mSize;
  for (size_t done = 0; done < steps; ++done)
  {
    mData[(mFront + mSize) % mCap] = mData[mFront];
    mFront = (mFront + 1) % mCap;
  }
}

#endif
