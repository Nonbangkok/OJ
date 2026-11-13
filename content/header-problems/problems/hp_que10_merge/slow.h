// Deliberately naive reference: it takes the elements one at a time and
// regrows the array to an exact fit for each of them. Perfectly correct — the
// queue it leaves behind is identical — but expand() copies the whole queue
// every time, so merging m elements into n costs Theta((n + m) * m) instead
// of O(n + m).
//
// This is the classic "grow by one" mistake rather than a contrived one, and
// verify.py requires it to be Accepted on cases 1-5 and to time out on case
// 6, which is what proves the large testcases really separate reserving once
// from reserving per element.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "queue.h"
using namespace std;

template <typename T>
void CP::queue<T>::merge(CP::queue<T> &other)
{
  while (!other.empty())
  {
    expand(mSize + 1); // exact fit, every single time
    mData[(mFront + mSize) % mCap] = other.front();
    mSize++;
    other.pop();
  }
}

#endif
