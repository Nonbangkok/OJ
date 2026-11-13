// Deliberately naive reference: CORRECT, but it copies the WHOLE vector into
// a scratch buffer first and then reads the two blocks back out of it.
//
// That is a real temptation — "take a snapshot, then I cannot possibly
// overwrite something I still need" — and it gives exactly the right answer.
// It just costs Theta(n) time and Theta(n) extra memory per call instead of
// Theta(len) and Theta(1), so twenty thousand swaps of eight elements on a
// million-element vector cost 2 * 10^10 element copies instead of 1.6 * 10^5.
// verify.py requires this file to pass cases 1-5 and to time out on case 6.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "vector.h"
using namespace std;

template <typename T>
void CP::vector<T>::block_swap(size_t i, size_t j, size_t len)
{
  if (len == 0 || len > mSize)
  {
    return;
  }
  if (i > mSize - len || j > mSize - len)
  {
    return;
  }
  size_t lo = i < j ? i : j;
  size_t hi = i < j ? j : i;
  if (hi - lo < len)
  {
    return;
  }
  T *scratch = new T[mSize]();
  for (size_t k = 0; k < mSize; k++)
  {
    scratch[k] = mData[k];
  }
  for (size_t k = 0; k < len; k++)
  {
    mData[lo + k] = scratch[hi + k];
    mData[hi + k] = scratch[lo + k];
  }
  delete[] scratch;
}

#endif
