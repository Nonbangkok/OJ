// Deliberately naive reference: CORRECT, but it rotates by ONE position k
// times, and each single-position rotation shifts the whole vector.
//
// Cost: Theta(k * n) instead of Theta(n). With k around a million on a
// 2,000,000-element vector that is 2 * 10^12 element moves, so it cannot
// survive the large cases. verify.py requires this file to pass cases 1-5 and
// to time out on case 6.
//
// Note what this file does NOT demonstrate: the other classic wrong answer is
// a rotation that allocates a temporary array of n elements, which is fast
// but needs twice the memory. That one is caught by the 32 MB memory limit
// rather than by the clock, and the harness's slow.h check only speaks about
// time — see .report-vector.md for the separate measurement of it.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "vector.h"
using namespace std;

template <typename T>
void CP::vector<T>::rotate(size_t k)
{
  if (mSize < 2)
  {
    return;
  }
  k = k % mSize;
  for (size_t turn = 0; turn < k; turn++)
  {
    T first = mData[0];
    for (size_t i = 1; i < mSize; i++)
    {
      mData[i - 1] = mData[i];
    }
    mData[mSize - 1] = first;
  }
}

#endif
