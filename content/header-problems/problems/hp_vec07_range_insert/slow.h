// Deliberately naive reference: CORRECT, but it inserts the block one element
// at a time, so the tail after `pos` is shifted again for every one of the m
// values.
//
// Cost: Theta(m * (n - pos)) instead of Theta(n + m). Appending a block
// (pos == mSize) is just as fast as the reference here — nothing has to move
// — which is exactly why the deciding testcases insert near the FRONT of a
// large vector. verify.py requires this file to pass cases 1-5 and to time
// out on case 6.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "vector.h"
using namespace std;

template <typename T>
void CP::vector<T>::range_insert(size_t pos, const std::vector<T> &values)
{
  if (values.size() == 0 || pos > mSize)
  {
    return;
  }
  for (size_t j = 0; j < values.size(); j++)
  {
    ensureCapacity(mSize + 1);
    for (size_t i = mSize; i > pos + j; i--)
    {
      mData[i] = mData[i - 1];
    }
    mData[pos + j] = values[j];
    mSize++;
  }
}

#endif
