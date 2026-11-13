// Deliberately naive reference: always slides the TAIL forwards, whatever i
// is. Perfectly correct, and O(1) when i is already near the back — but
// Theta(mSize) for every erase near the front, which is most of them in the
// large cases.
//
// verify.py requires this file to be Accepted on cases 1-5 and to time out on
// case 6, which is what proves the large testcases really separate
// O(min(i, n - 1 - i)) from "pick one side and hope".
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "queue.h"
using namespace std;

template <typename T>
void CP::queue<T>::erase(size_t i)
{
  if (i >= mSize)
    return;

  for (size_t position = i; position + 1 < mSize; ++position)
  {
    mData[(mFront + position) % mCap] = mData[(mFront + position + 1) % mCap];
  }
  mSize--;
}

#endif
