// Deliberately naive reference: CORRECT, but it removes one duplicate at a
// time and shifts the whole tail left after each removal.
//
// This is the obvious way to write it if you think of compress() as "keep
// erasing a duplicate until there is none left", and on a short vector it
// looks fine. Cost: Theta(n) per removed element, so a million elements that
// are mostly duplicates cost upwards of 10^11 element moves instead of 10^6.
// verify.py requires this file to pass cases 1-5 and to time out on case 6.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "vector.h"
using namespace std;

template <typename T>
void CP::vector<T>::compress()
{
  size_t i = 1;
  while (i < mSize)
  {
    if (mData[i] == mData[i - 1])
    {
      for (size_t j = i; j + 1 < mSize; j++)
      {
        mData[j] = mData[j + 1];
      }
      mSize--;
    }
    else
    {
      i++;
    }
  }
}

#endif
